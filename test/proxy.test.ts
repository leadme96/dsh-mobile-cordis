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
  });

  // WebSocket tests deferred - require 'ws' package
  // describe('WebSocket proxying', () => { ... });
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
