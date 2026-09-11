import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { ReverseProxy } from './proxy.ts';
import { MobileService } from './service.ts';
import { SettingsManager } from './settings.ts';
import qrcodeTerminal from 'qrcode-terminal';

export const name = 'dsh-mobile';

/**
 * Minimal shape of the host Connection service this plugin consumes. Declared
 * locally because `@deepseek-ai/dsh-client-connection` ships inside the DSH
 * runtime rather than as an installable dependency of an external plugin.
 */
interface ConnectionService {
  rpc?: {
    handle?: (
      channel: string,
      handler: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>,
    ) => () => void;
  };
  /** Root URL carrying this process's launch token (mints a browser session on first visit). */
  authenticatedUrl?: (baseUrl: string) => string;
}

/** Minimal shape of the host web server service (owns the real DSH HTTP port). */
interface WebServerService {
  port?: number;
  host?: string;
}

export interface Config {
  enabled: boolean;
  port: number;
  upstreamPort: number;
  lanIpOverride: string;
  pinEnabled: boolean;
  customPin: string;
  heartbeatInterval: number;
  dshHome: string;
}

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

export function apply(ctx: Context, config: Config): void {
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
  let proxy: ReverseProxy | undefined;
  let connectionService: ConnectionService | undefined;
  let currentPin: string | undefined;
  let proxyRunning = false;

  /**
   * The phone-facing URL. DSH guards its web server with a per-process launch
   * token, so the URL must carry it: the first visit exchanges the token for a
   * browser-session cookie, after which ordinary navigation works. The PIN rides
   * as `pin`, never as `token` — that query key belongs to DSH.
   */
  const buildAccessUrl = (): string | null => {
    const port = proxy?.getPort();
    if (!lanIp || !port) return null;

    const base = `http://${lanIp}:${port}/`;
    const authenticated = connectionService?.authenticatedUrl?.(base) ?? base;

    const url = new URL(authenticated);
    if (config.pinEnabled && currentPin) url.searchParams.set('pin', currentPin);
    return url.href;
  };

  // The DSH web server owns its port — DSH Desktop binds an ephemeral one, so a
  // hardcoded upstream default proxies into nothing and answers 502.
  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = (hostCtx as unknown as { webServer?: WebServerService }).webServer;
    const upstreamPort = webServer?.port && webServer.port > 0 ? webServer.port : config.upstreamPort;

    if (!upstreamPort) {
      log(hostCtx, 'No DSH web port available — mobile proxy not started');
      return;
    }

    hostCtx.effect(async () => {
      currentPin = await settingsManager.getPin();

      proxy = new ReverseProxy({
        port: config.port,
        upstreamHost: '127.0.0.1',
        upstreamPort,
        pinEnabled: config.pinEnabled,
        pin: currentPin,
        heartbeatInterval: config.heartbeatInterval,
      });

      try {
        await proxy.start();
        proxyRunning = true;

        log(hostCtx, `Mobile proxy listening on 0.0.0.0:${proxy.getPort()} → 127.0.0.1:${upstreamPort}`);

        const accessUrl = buildAccessUrl();
        if (accessUrl) {
          log(hostCtx, `Access URL: ${accessUrl}`);
          qrcodeTerminal.generate(accessUrl, { small: true }, (qr: string) => {
            console.log(qr);
          });
        } else {
          log(hostCtx, 'Warning: no access URL yet (LAN IP or proxy port missing)');
        }
      } catch (err) {
        log(hostCtx, `Failed to start proxy: ${err}`);
        throw err;
      }

      return async () => {
        if (proxy) {
          await proxy.stop();
          proxyRunning = false;
          log(hostCtx, 'Mobile access proxy stopped');
        }
      };
    }, 'dsh-mobile: reverse proxy');
  });

  // The Connection service may still be activating while this plugin applies, so
  // wait for it: reading it once through `ctx.get` would leave the channel
  // unregistered and surface as HTTP 405 in the settings panel.
  ctx.inject(['connection'], (rpcCtx) => {
    connectionService = (rpcCtx as unknown as { connection?: ConnectionService }).connection;
    const handle = connectionService?.rpc?.handle;

    if (typeof handle !== 'function') {
      log(rpcCtx, 'Host Connection RPC unavailable — settings panel disabled');
      return;
    }

    handle('/dsh-mobile', async (endpoint: string, payload: unknown = {}) => {
      switch (endpoint) {
        case 'status': {
          const accessUrl = buildAccessUrl();
          const qrDataUrl = accessUrl ? await mobileService.generateQrCode(accessUrl) : null;

          return {
            ok: true,
            value: {
              enabled: true,
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

        case 'generateQr': {
          const { url } = payload as { url: string };
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
 * Logger that uses the Cordis logger if available, falling back to the console.
 */
function log(ctx: Context, message: string): void {
  const logger = ctx.get?.('logger');
  if (logger && typeof logger.info === 'function') {
    logger.info(`[dsh-mobile] ${message}`);
  } else {
    console.log(`[dsh-mobile] ${message}`);
  }
}
