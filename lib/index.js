import Schema from '@deepseek-ai/schemastery';
import { ReverseProxy } from "./proxy.js";
import { MobileService } from "./service.js";
import { SettingsManager } from "./settings.js";
import qrcodeTerminal from 'qrcode-terminal';
export const name = 'dsh-mobile';
export const Config = Schema.object({
    enabled: Schema.boolean().default(true).description('Enable mobile access proxy'),
    port: Schema.number().default(3081).description('Proxy port (listens on 0.0.0.0)'),
    upstreamPort: Schema.number().default(0).description('Fallback DSH web port (0 = read the live web server port)'),
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
    const isDesktop = ctx.get?.('desktopProfiles') !== undefined;
    if (isDesktop) {
        log(ctx, 'Running in DSH Desktop environment');
    }
    const settingsManager = new SettingsManager(config.dshHome, config.customPin || undefined);
    const mobileService = new MobileService({ lanIpOverride: config.lanIpOverride || undefined });
    const lanIp = mobileService.detectLanIp();
    if (!lanIp) {
        log(ctx, 'Warning: Could not detect LAN IP. Use lanIpOverride to set manually.');
    }
    // State shared by the proxy half and the RPC half of the plugin.
    let proxy;
    let connectionService;
    let currentPin;
    let proxyRunning = false;
    let manuallyEnabled = true; // Manual toggle state
    let upstreamPort = 0;
    /**
     * The phone-facing URL. DSH guards its web server with a per-process launch
     * token, so the URL must carry it: the first visit exchanges the token for a
     * browser-session cookie, after which ordinary navigation works. The PIN rides
     * as `pin`, never as `token` — that query key belongs to DSH.
     */
    const buildAccessUrl = () => {
        const port = proxy?.getPort();
        if (!lanIp || !port)
            return null;
        const base = `http://${lanIp}:${port}/`;
        const authenticated = connectionService?.authenticatedUrl?.(base) ?? base;
        const url = new URL(authenticated);
        if (config.pinEnabled && currentPin)
            url.searchParams.set('pin', currentPin);
        return url.href;
    };
    // The DSH web server owns its port — DSH Desktop binds an ephemeral one, so a
    // hardcoded upstream default proxies into nothing and answers 502.
    ctx.inject(['webServer'], (hostCtx) => {
        const webServer = hostCtx.webServer;
        upstreamPort = webServer?.port && webServer.port > 0 ? webServer.port : config.upstreamPort;
        if (!upstreamPort) {
            log(hostCtx, 'No DSH web port available — mobile proxy not started');
            return;
        }
        hostCtx.effect(async () => {
            currentPin = await settingsManager.getPin();
            // Auto-start proxy if manually enabled
            if (manuallyEnabled) {
                await startProxy(hostCtx);
            }
            return async () => {
                await stopProxy(hostCtx);
            };
        }, 'dsh-mobile: reverse proxy');
    });
    /**
     * Start the proxy server.
     */
    async function startProxy(logCtx) {
        if (proxyRunning || !upstreamPort)
            return;
        proxy = new ReverseProxy({
            port: config.port,
            upstreamHost: '127.0.0.1',
            upstreamPort,
            pinEnabled: config.pinEnabled,
            ...(currentPin ? { pin: currentPin } : {}),
            heartbeatInterval: config.heartbeatInterval,
        });
        try {
            await proxy.start();
            proxyRunning = true;
            log(logCtx, `Mobile proxy listening on 0.0.0.0:${proxy.getPort()} → 127.0.0.1:${upstreamPort}`);
            const accessUrl = buildAccessUrl();
            if (accessUrl) {
                log(logCtx, `Access URL: ${accessUrl}`);
                qrcodeTerminal.generate(accessUrl, { small: true }, (qr) => {
                    console.log(qr);
                });
            }
            else {
                log(logCtx, 'Warning: no access URL yet (LAN IP or proxy port missing)');
            }
        }
        catch (err) {
            log(logCtx, `Failed to start proxy: ${err}`);
            throw err;
        }
    }
    /**
     * Stop the proxy server.
     */
    async function stopProxy(logCtx) {
        if (!proxyRunning || !proxy)
            return;
        await proxy.stop();
        proxyRunning = false;
        proxy = undefined;
        log(logCtx, 'Mobile access proxy stopped');
    }
    // The Connection service may still be activating while this plugin applies, so
    // wait for it: reading it once through `ctx.get` would leave the channel
    // unregistered and surface as HTTP 405 in the settings panel.
    ctx.inject(['connection'], (rpcCtx) => {
        connectionService = rpcCtx.connection;
        const handle = connectionService?.rpc?.handle;
        if (typeof handle !== 'function') {
            log(rpcCtx, 'Host Connection RPC unavailable — settings panel disabled');
            return;
        }
        handle('/dsh-mobile', async (endpoint, payload = {}) => {
            switch (endpoint) {
                case 'status': {
                    const accessUrl = buildAccessUrl();
                    const qrDataUrl = accessUrl ? await mobileService.generateQrCode(accessUrl) : null;
                    return {
                        ok: true,
                        value: {
                            enabled: manuallyEnabled,
                            proxyRunning,
                            lanIp: lanIp || null,
                            port: proxy?.getPort() ?? null,
                            pinEnabled: config.pinEnabled,
                            pin: currentPin || null,
                            accessUrl,
                            qrDataUrl,
                            isDesktop,
                        },
                    };
                }
                case 'toggle': {
                    const { enabled } = payload;
                    manuallyEnabled = enabled;
                    if (enabled) {
                        await startProxy(ctx);
                    }
                    else {
                        await stopProxy(ctx);
                    }
                    return { ok: true, value: { enabled: manuallyEnabled, proxyRunning } };
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
        log(rpcCtx, 'RPC channel /dsh-mobile registered');
    });
}
/**
 * Logger that uses the Cordis context logger, falling back to the console.
 * `ctx.logger` is a context property rather than a service, so it is read
 * directly instead of through `ctx.get` (which would silently fall through to
 * the console and leave plugin output out of the application log).
 */
function log(ctx, message) {
    const logger = ctx.logger;
    if (logger && typeof logger.info === 'function') {
        logger.info(`[dsh-mobile] ${message}`);
    }
    else {
        console.log(`[dsh-mobile] ${message}`);
    }
}
