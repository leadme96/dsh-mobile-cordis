import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { ReverseProxy, type ProxyConfig } from '../src/proxy.ts';

describe('proxy', () => {
  let upstreamServer: Server;
  let upstreamPort: number;
  let proxy: ReverseProxy;
  let proxyPort: number;

  beforeEach(async () => {
    // Create upstream server (simulates DSH web)
    upstreamServer = createServer((req, res) => {
      // Echo back headers for verification
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        url: req.url,
        headers: req.headers,
      }));
    });

    await new Promise<void>((resolve) => {
      upstreamServer.listen(0, '127.0.0.1', () => resolve());
    });
    upstreamPort = (upstreamServer.address() as any).port;
  });

  afterEach(async () => {
    if (proxy) {
      await proxy.stop();
    }
    await new Promise<void>((resolve) => {
      upstreamServer.close(() => resolve());
    });
  });

  describe('HTTP proxying', () => {
    it('should forward requests to upstream', async () => {
      const config: ProxyConfig = {
        port: 0, // Random port
        upstreamHost: '127.0.0.1',
        upstreamPort,
      };

      proxy = new ReverseProxy(config);
      await proxy.start();
      proxyPort = proxy.getPort()!;

      // Make request to proxy
      const response = await makeRequest(`http://127.0.0.1:${proxyPort}/test`);
      const body = JSON.parse(response.body);

      expect(body.url).toBe('/test');
    });

    it('should rewrite Host header to upstream', async () => {
      const config: ProxyConfig = {
        port: 0,
        upstreamHost: '127.0.0.1',
        upstreamPort,
      };

      proxy = new ReverseProxy(config);
      await proxy.start();
      proxyPort = proxy.getPort()!;

      const response = await makeRequest(`http://127.0.0.1:${proxyPort}/`);
      const body = JSON.parse(response.body);

      expect(body.headers.host).toBe(`127.0.0.1:${upstreamPort}`);
    });

    it('should rewrite Origin header to upstream', async () => {
      const config: ProxyConfig = {
        port: 0,
        upstreamHost: '127.0.0.1',
        upstreamPort,
      };

      proxy = new ReverseProxy(config);
      await proxy.start();
      proxyPort = proxy.getPort()!;

      const response = await makeRequest(`http://127.0.0.1:${proxyPort}/`, {
        headers: { Origin: 'http://192.168.1.50:3081' },
      });
      const body = JSON.parse(response.body);

      expect(body.headers.origin).toBe(`http://127.0.0.1:${upstreamPort}`);
    });
  });

  describe('PIN authentication', () => {
    it('should reject requests without PIN when enabled', async () => {
      const config: ProxyConfig = {
        port: 0,
        upstreamHost: '127.0.0.1',
        upstreamPort,
        pinEnabled: true,
        pin: '12345678',
      };

      proxy = new ReverseProxy(config);
      await proxy.start();
      proxyPort = proxy.getPort()!;

      const response = await makeRequest(`http://127.0.0.1:${proxyPort}/`);
      expect(response.statusCode).toBe(401);
    });

    it('should accept requests with valid PIN', async () => {
      const config: ProxyConfig = {
        port: 0,
        upstreamHost: '127.0.0.1',
        upstreamPort,
        pinEnabled: true,
        pin: '12345678',
      };

      proxy = new ReverseProxy(config);
      await proxy.start();
      proxyPort = proxy.getPort()!;

      const response = await makeRequest(
        `http://127.0.0.1:${proxyPort}/?pin=12345678`
      );
      expect(response.statusCode).toBe(200);
    });

    it('should reject requests with invalid PIN', async () => {
      const config: ProxyConfig = {
        port: 0,
        upstreamHost: '127.0.0.1',
        upstreamPort,
        pinEnabled: true,
        pin: '12345678',
      };

      proxy = new ReverseProxy(config);
      await proxy.start();
      proxyPort = proxy.getPort()!;

      const response = await makeRequest(
        `http://127.0.0.1:${proxyPort}/?token=wrongpin`
      );
      expect(response.statusCode).toBe(401);
    });

    it('should allow all requests when PIN disabled', async () => {
      const config: ProxyConfig = {
        port: 0,
        upstreamHost: '127.0.0.1',
        upstreamPort,
        pinEnabled: false,
      };

      proxy = new ReverseProxy(config);
      await proxy.start();
      proxyPort = proxy.getPort()!;

      const response = await makeRequest(`http://127.0.0.1:${proxyPort}/`);
      expect(response.statusCode).toBe(200);
    });
  });

  describe('__DSH_TRANSPORT__ shim injection', () => {
    it('should inject shim into HTML responses', async () => {
      // Create upstream that returns HTML
      const htmlServer = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head></head><body>Test</body></html>');
      });

      await new Promise<void>((resolve) => {
        htmlServer.listen(0, '127.0.0.1', () => resolve());
      });
      const htmlPort = (htmlServer.address() as any).port;

      const config: ProxyConfig = {
        port: 0,
        upstreamHost: '127.0.0.1',
        upstreamPort: htmlPort,
      };

      proxy = new ReverseProxy(config);
      await proxy.start();
      proxyPort = proxy.getPort()!;

      const response = await makeRequest(`http://127.0.0.1:${proxyPort}/`);
      expect(response.body).toContain('__DSH_TRANSPORT__');

      await new Promise<void>((resolve) => {
        htmlServer.close(() => resolve());
      });
    });

    it('should not inject shim into non-HTML responses', async () => {
      const config: ProxyConfig = {
        port: 0,
        upstreamHost: '127.0.0.1',
        upstreamPort,
      };

      proxy = new ReverseProxy(config);
      await proxy.start();
      proxyPort = proxy.getPort()!;

      const response = await makeRequest(`http://127.0.0.1:${proxyPort}/`);
      expect(response.body).not.toContain('__DSH_TRANSPORT__');
    });

    it('should inject mobile UI adaptation CSS and JS into HTML responses', async () => {
      const htmlServer = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head></head><body>Test</body></html>');
      });

      await new Promise<void>((resolve) => {
        htmlServer.listen(0, '127.0.0.1', () => resolve());
      });
      const htmlPort = (htmlServer.address() as any).port;

      const config: ProxyConfig = {
        port: 0,
        upstreamHost: '127.0.0.1',
        upstreamPort: htmlPort,
      };

      proxy = new ReverseProxy(config);
      await proxy.start();
      proxyPort = proxy.getPort()!;

      const response = await makeRequest(`http://127.0.0.1:${proxyPort}/`);

      // Verify mobile adaptation code is injected
      expect(response.body).toContain('data-dsh-mobile');
      expect(response.body).toContain('isMobile');
      expect(response.body).toContain('hideDesktopOnlyNav');

      // Verify the CSS contains key mobile adaptations (inlined from MOBILE_CSS constant)
      expect(response.body).toContain('dshDesktopFrame');
      expect(response.body).toContain('grid-template-columns');
      expect(response.body).toContain('translateX(-100%)');
      expect(response.body).toContain('dsh-mobile-sidebar-width');
      expect(response.body).toContain('dsh-mobile-touch-target');

      await new Promise<void>((resolve) => {
        htmlServer.close(() => resolve());
      });
    });

    it('should not re-inject shim if already present', async () => {
      const htmlServer = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><script data-dsh-mobile-shim>already injected</script></head><body>Test</body></html>');
      });

      await new Promise<void>((resolve) => {
        htmlServer.listen(0, '127.0.0.1', () => resolve());
      });
      const htmlPort = (htmlServer.address() as any).port;

      const config: ProxyConfig = {
        port: 0,
        upstreamHost: '127.0.0.1',
        upstreamPort: htmlPort,
      };

      proxy = new ReverseProxy(config);
      await proxy.start();
      proxyPort = proxy.getPort()!;

      const response = await makeRequest(`http://127.0.0.1:${proxyPort}/`);

      // Should not contain duplicate shim markers
      const markerCount = (response.body.match(/data-dsh-mobile-shim/g) || []).length;
      expect(markerCount).toBe(1);

      await new Promise<void>((resolve) => {
        htmlServer.close(() => resolve());
      });
    });
  });

  describe('WebSocket proxying', () => {
    it('should complete the handshake so the client socket opens', async () => {
      const { createHash } = await import('node:crypto');
      const { connect } = await import('node:net');

      const key = 'dGhlIHNhbXBsZSBub25jZQ==';
      const expectedAccept = createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');

      const upstreamSockets = new Set<import('node:net').Socket>();

      upstreamServer.on('upgrade', (req, rawSocket) => {
        // node types the upgrade socket as a bare Duplex; it is a net.Socket.
        const socket = rawSocket as import('node:net').Socket;
        upstreamSockets.add(socket);
        socket.on('close', () => upstreamSockets.delete(socket));

        const accept = createHash('sha1')
          .update(`${String(req.headers['sec-websocket-key'])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest('base64');
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
        // Echo whole frames so the test can prove the tunnel carries bytes.
        socket.on('data', (chunk) => socket.write(chunk));
      });

      const config: ProxyConfig = { port: 0, upstreamHost: '127.0.0.1', upstreamPort };
      proxy = new ReverseProxy(config);
      await proxy.start();
      proxyPort = proxy.getPort()!;

      const received = await new Promise<string>((resolve, reject) => {
        const client = connect(proxyPort, '127.0.0.1', () => {
          client.write(
            'GET /ws HTTP/1.1\r\n' +
              `Host: 127.0.0.1:${proxyPort}\r\n` +
              'Upgrade: websocket\r\n' +
              'Connection: Upgrade\r\n' +
              `Sec-WebSocket-Key: ${key}\r\n` +
              'Sec-WebSocket-Version: 13\r\n\r\n'
          );
        });

        let buffer = Buffer.alloc(0);
        const timer = setTimeout(() => {
          client.destroy();
          reject(new Error('timed out waiting for the 101 handshake through the proxy'));
        }, 3000);

        client.on('data', (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          if (!buffer.includes(Buffer.from('\r\n\r\n'))) return;
          clearTimeout(timer);
          client.destroy();
          resolve(buffer.toString('latin1'));
        });
        client.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      // Release the upstream half so the shared server can close in `afterEach`.
      for (const socket of upstreamSockets) socket.destroy();

      // The defect this covers: the proxy piped the sockets without replaying
      // upstream's 101, so the browser never saw a completed handshake.
      // Header names are case-insensitive — node's HTTP client lowercases them.
      expect(received.toLowerCase()).toContain('101 switching protocols');
      expect(received.toLowerCase()).toContain(`sec-websocket-accept: ${expectedAccept.toLowerCase()}`);
    });
  });
});

// Helper to make HTTP requests
function makeRequest(
  url: string,
  options: { headers?: Record<string, string> } = {}
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers: options.headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode!, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
