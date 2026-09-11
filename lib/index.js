import Schema from '@deepseek-ai/schemastery';
import { ReverseProxy } from "./proxy.js";
import { MobileService } from "./service.js";
import { SettingsManager } from "./settings.js";
import qrcodeTerminal from 'qrcode-terminal';
export const name = 'dsh-mobile';
export const Config = Schema.object({
    enabled: Schema.boolean().default(true).description('Enable mobile access proxy'),
    port: Schema.number().default(3081).description('Proxy port (listens on 0.0.0.0)'),
    upstreamPort: Schema.number().default(3080).description('DSH web upstream port (127.0.0.1)'),
    lanIpOverride: Schema.string().default('').description('Manually override detected LAN IP (empty for auto-detect)'),
    pinEnabled: Schema.boolean().default(false).description('Require PIN for access'),
    customPin: Schema.string().default('').description('Custom PIN (8 digits, empty for auto-generated)'),
    heartbeatInterval: Schema.number().default(30).description('WebSocket heartbeat interval in seconds (0 to disable)'),
    dshHome: Schema.string().default(process.env.DSH_HOME || process.env.HOME || '/tmp').description('DSH home directory for settings'),
});
export function apply(ctx, config) {
    if (!config.enabled) {
        log(ctx, 'Mobile access disabled by config');
        return;
    }
    // Detect DSH Desktop environment
    const isDesktop = ctx.get?.('desktopProfiles') !== undefined;
    if (isDesktop) {
        log(ctx, 'Running in DSH Desktop environment');
    }
    // Initialize services
    const settingsManager = new SettingsManager(config.dshHome, config.customPin || undefined);
    const mobileService = new MobileService({ lanIpOverride: config.lanIpOverride || undefined });
    // Detect LAN IP
    const lanIp = mobileService.detectLanIp();
    if (!lanIp) {
        log(ctx, 'Warning: Could not detect LAN IP. Use lanIpOverride to set manually.');
    }
    // State for RPC
    let proxy;
    let currentPin;
    let proxyRunning = false;
    // Register RPC channel for client communication
    ctx.effect(() => {
        const connection = ctx.get?.('connection');
        if (connection?.rpc?.handle) {
            const disposer = connection.rpc.handle('/dsh-mobile', async (endpoint, payload = {}) => {
                switch (endpoint) {
                    case 'status': {
                        const actualPort = proxy?.getPort();
                        const accessUrl = lanIp && actualPort
                            ? mobileService.getAccessUrl(lanIp, actualPort, config.pinEnabled, currentPin)
                            : null;
                        const qrDataUrl = accessUrl
                            ? await mobileService.generateQrCode(accessUrl)
                            : null;
                        return {
                            ok: true,
                            value: {
                                enabled: true,
                                proxyRunning,
                                lanIp: lanIp || null,
                                port: actualPort || null,
                                pinEnabled: config.pinEnabled,
                                pin: currentPin || null,
                                accessUrl,
                                qrDataUrl,
                                isDesktop,
                            },
                        };
                    }
                    case 'generateQr': {
                        const { url } = payload;
                        const qr = await mobileService.generateQrCode(url);
                        return { ok: true, value: qr };
                    }
                    default:
                        return { ok: false, error: { code: 'bad-request', message: `Unknown endpoint: ${endpoint}`, details: {} } };
                }
            });
            return disposer;
        }
    });
    // Start proxy
    ctx.effect(async () => {
        // Get or generate PIN
        currentPin = await settingsManager.getPin();
        // Create proxy config
        const proxyConfig = {
            port: config.port,
            upstreamHost: '127.0.0.1',
            upstreamPort: config.upstreamPort,
            pinEnabled: config.pinEnabled,
            pin: currentPin,
            heartbeatInterval: config.heartbeatInterval,
        };
        proxy = new ReverseProxy(proxyConfig);
        try {
            await proxy.start();
            proxyRunning = true;
            const actualPort = proxy.getPort();
            log(ctx, `Mobile access proxy started on port ${actualPort}`);
            if (lanIp) {
                const accessUrl = mobileService.getAccessUrl(lanIp, actualPort, config.pinEnabled, currentPin);
                log(ctx, `Access URL: ${accessUrl}`);
                // Generate QR code for terminal
                const qrUrl = config.pinEnabled ? `${accessUrl}?token=${currentPin}` : accessUrl;
                qrcodeTerminal.generate(qrUrl, { small: true }, (qr) => {
                    console.log(qr);
                });
            }
        }
        catch (err) {
            log(ctx, `Failed to start proxy: ${err}`);
            throw err;
        }
        // Return disposer
        return async () => {
            if (proxy) {
                await proxy.stop();
                proxyRunning = false;
                log(ctx, 'Mobile access proxy stopped');
            }
        };
    });
}
/**
 * Logger that uses Cordis logger if available, falls back to console.
 */
function log(ctx, message) {
    const logger = ctx.get?.('logger');
    if (logger && typeof logger.info === 'function') {
        logger.info(`[dsh-mobile] ${message}`);
    }
    else {
        console.log(`[dsh-mobile] ${message}`);
    }
}
