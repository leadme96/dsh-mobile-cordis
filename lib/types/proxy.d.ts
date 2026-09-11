export interface ProxyConfig {
    port: number;
    upstreamHost: string;
    upstreamPort: number;
    pinEnabled?: boolean;
    pin?: string;
    heartbeatInterval?: number;
}
/**
 * Reverse proxy that forwards HTTP and WebSocket requests to upstream,
 * rewriting Host/Origin headers to make upstream trust the requests.
 */
export declare class ReverseProxy {
    private readonly config;
    private server;
    private port;
    /** Live client sockets, tracked so `stop()` can tear down upgraded tunnels. */
    private readonly sockets;
    constructor(config: ProxyConfig);
    /**
     * Start the proxy server.
     */
    start(): Promise<void>;
    /**
     * Stop the proxy server. Upgraded sockets outlive a plain `close()`, so they
     * are destroyed first — otherwise stopping hangs until every tunnel ends.
     */
    stop(): Promise<void>;
    /**
     * Get the port the proxy is listening on.
     */
    getPort(): number | undefined;
    /**
     * Handle HTTP requests.
     */
    private handleHttp;
    /**
     * Handle WebSocket upgrades.
     */
    private handleWebSocket;
    /**
     * Inject __DSH_TRANSPORT__ shim into HTML.
     */
    private injectTransportShim;
}
