import { createServer, request as httpRequest, } from 'node:http';
/**
 * Reverse proxy that forwards HTTP and WebSocket requests to upstream,
 * rewriting Host/Origin headers to make upstream trust the requests.
 */
export class ReverseProxy {
    config;
    server;
    port;
    constructor(config) {
        this.config = config;
    }
    /**
     * Start the proxy server.
     */
    async start() {
        this.server = createServer((req, res) => this.handleHttp(req, res));
        // Handle WebSocket upgrades
        this.server.on('upgrade', (req, socket, head) => {
            this.handleWebSocket(req, socket, head);
        });
        return new Promise((resolve, reject) => {
            this.server.listen(this.config.port, '0.0.0.0', () => {
                this.port = this.server.address().port;
                resolve();
            });
            this.server.on('error', reject);
        });
    }
    /**
     * Stop the proxy server.
     */
    async stop() {
        if (!this.server)
            return;
        return new Promise((resolve) => {
            this.server.close(() => resolve());
        });
    }
    /**
     * Get the port the proxy is listening on.
     */
    getPort() {
        return this.port;
    }
    /**
     * Handle HTTP requests.
     */
    async handleHttp(req, res) {
        try {
            // Check PIN authentication if enabled. The PIN rides as `pin`: `token` is
            // DSH's own launch-token query key and must pass through untouched.
            if (this.config.pinEnabled && this.config.pin) {
                const url = new URL(req.url || '/', `http://${req.headers.host}`);
                const token = url.searchParams.get('pin');
                if (token !== this.config.pin) {
                    res.writeHead(401, { 'Content-Type': 'text/plain' });
                    res.end('Unauthorized: Invalid or missing PIN');
                    return;
                }
            }
            // Rewrite headers
            const headers = { ...req.headers };
            headers.host = `${this.config.upstreamHost}:${this.config.upstreamPort}`;
            headers.origin = `http://${this.config.upstreamHost}:${this.config.upstreamPort}`;
            // Forward request to upstream
            const proxyReq = httpRequest({
                hostname: this.config.upstreamHost,
                port: this.config.upstreamPort,
                path: req.url,
                method: req.method,
                headers,
            }, (proxyRes) => {
                // Check if response is HTML and needs shim injection
                const contentType = proxyRes.headers['content-type'] || '';
                if (contentType.includes('text/html')) {
                    // Buffer response and inject shim
                    const chunks = [];
                    proxyRes.on('data', (chunk) => chunks.push(chunk));
                    proxyRes.on('end', () => {
                        let body = Buffer.concat(chunks).toString('utf-8');
                        body = this.injectTransportShim(body);
                        // Remove transfer-encoding since we're buffering
                        const headers = { ...proxyRes.headers };
                        delete headers['transfer-encoding'];
                        headers['content-length'] = Buffer.byteLength(body).toString();
                        res.writeHead(proxyRes.statusCode || 200, headers);
                        res.end(body);
                    });
                }
                else {
                    // Forward response as-is
                    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                    proxyRes.pipe(res);
                }
            });
            proxyReq.on('error', (err) => {
                console.error('[dsh-mobile] Proxy request error:', err);
                if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'text/plain' });
                    res.end('Bad Gateway');
                }
            });
            req.pipe(proxyReq);
        }
        catch (err) {
            console.error('[dsh-mobile] HTTP handler error:', err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
            }
        }
    }
    /**
     * Handle WebSocket upgrades.
     */
    handleWebSocket(req, socket, head) {
        // Rewrite headers
        const headers = { ...req.headers };
        headers.host = `${this.config.upstreamHost}:${this.config.upstreamPort}`;
        headers.origin = `http://${this.config.upstreamHost}:${this.config.upstreamPort}`;
        // Connect to upstream WebSocket
        const proxyReq = httpRequest({
            hostname: this.config.upstreamHost,
            port: this.config.upstreamPort,
            path: req.url,
            method: 'GET',
            headers: {
                ...headers,
                connection: 'Upgrade',
                upgrade: 'websocket',
            },
        });
        proxyReq.on('upgrade', (_proxyRes, proxySocket) => {
            // Bidirectionally pipe the sockets
            socket.write(head);
            proxySocket.pipe(socket);
            socket.pipe(proxySocket);
            // Setup heartbeat if configured
            if (this.config.heartbeatInterval && this.config.heartbeatInterval > 0) {
                const interval = setInterval(() => {
                    try {
                        // Send ping frame (opcode 0x9)
                        socket.write(Buffer.from([0x89, 0x00]));
                    }
                    catch {
                        // Ignore errors, connection will be cleaned up
                    }
                }, this.config.heartbeatInterval * 1000);
                socket.on('close', () => clearInterval(interval));
            }
            proxySocket.on('error', (err) => {
                console.error('[dsh-mobile] WebSocket proxy error:', err);
                socket.destroy();
            });
        });
        proxyReq.on('error', (err) => {
            console.error('[dsh-mobile] WebSocket upgrade error:', err);
            socket.destroy();
        });
        socket.on('error', (err) => {
            console.error('[dsh-mobile] Client socket error:', err);
            proxyReq.destroy();
        });
        proxyReq.end();
    }
    /**
     * Inject __DSH_TRANSPORT__ shim into HTML.
     */
    injectTransportShim(html) {
        // Check if already injected
        if (html.includes('data-dsh-mobile-shim')) {
            return html;
        }
        const shim = `
<script data-dsh-mobile-shim>
// dsh-mobile: __DSH_TRANSPORT__ shim for non-localhost origins
if (!globalThis.__DSH_TRANSPORT__?.createApiClient) {
  globalThis.__DSH_TRANSPORT__ = globalThis.__DSH_TRANSPORT__ || {};
  globalThis.__DSH_TRANSPORT__.createApiClient = () => null;
}
</script>
`;
        // Insert after <head>
        return html.replace(/<head([^>]*)>/, `<head$1>${shim}`);
    }
}
