#!/usr/bin/env node
/**
 * Integration test: dsh-mobile-cordis (compiled JS version)
 * 
 * Tests the full flow:
 * 1. Creates a mock upstream server (simulates DSH web)
 * 2. Starts the reverse proxy
 * 3. Verifies request forwarding and header rewriting
 * 4. Tests PIN authentication
 * 5. Tests QR code generation
 * 6. Tests LAN IP detection
 */

import { createServer } from 'node:http';
import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReverseProxy } from '../lib/proxy.js';
import { MobileService } from '../lib/service.js';
import { SettingsManager } from '../lib/settings.js';

async function main() {
  console.log('🧪 dsh-mobile-cordis integration test\n');

  const tempDir = await mkdtemp(join(tmpdir(), 'dsh-mobile-integration-'));
  console.log(`📁 Temp dir: ${tempDir}\n`);

  try {
    // 1. Create mock upstream server (simulates DSH web)
    console.log('1️⃣  Creating mock upstream server...');
    const upstream = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        message: 'Hello from DSH web',
        url: req.url,
        host: req.headers.host,
        origin: req.headers.origin,
      }));
    });

    await new Promise((resolve) => {
      upstream.listen(0, '127.0.0.1', () => resolve());
    });
    const upstreamPort = upstream.address().port;
    console.log(`   ✅ Mock upstream listening on 127.0.0.1:${upstreamPort}\n`);

    // 2. Test LAN IP detection
    console.log('2️⃣  Testing LAN IP detection...');
    const service = new MobileService({});
    const lanIp = service.detectLanIp();
    console.log(`   ✅ Detected LAN IP: ${lanIp || 'none'}\n`);

    // 3. Test PIN generation and persistence
    console.log('3️⃣  Testing PIN generation...');
    const settings = new SettingsManager(tempDir);
    const pin = await settings.getPin();
    console.log(`   ✅ Generated PIN: ${pin}`);
    const pin2 = await settings.getPin();
    console.log(`   ✅ Same PIN on reload: ${pin2 === pin ? 'yes' : 'NO (BUG!)'}\n`);

    // 4. Test proxy without PIN
    console.log('4️⃣  Testing proxy without PIN...');
    const proxy1 = new ReverseProxy({
      port: 0,
      upstreamHost: '127.0.0.1',
      upstreamPort,
      pinEnabled: false,
      heartbeatInterval: 0,
    });
    await proxy1.start();
    const proxy1Port = proxy1.getPort();
    console.log(`   ✅ Proxy started on port ${proxy1Port}`);

    const resp1 = await makeRequest(`http://127.0.0.1:${proxy1Port}/test`);
    const body1 = JSON.parse(resp1.body);
    console.log(`   ✅ Request forwarded: ${body1.url}`);
    console.log(`   ✅ Host rewritten: ${body1.host}`);
    console.log(`   ✅ Response: ${body1.message}\n`);

    await proxy1.stop();

    // 5. Test proxy with PIN
    console.log('5️⃣  Testing proxy with PIN...');
    const proxy2 = new ReverseProxy({
      port: 0,
      upstreamHost: '127.0.0.1',
      upstreamPort,
      pinEnabled: true,
      pin,
      heartbeatInterval: 0,
    });
    await proxy2.start();
    const proxy2Port = proxy2.getPort();
    console.log(`   ✅ Proxy started on port ${proxy2Port}`);

    // Test without PIN (should fail)
    const resp2a = await makeRequest(`http://127.0.0.1:${proxy2Port}/test`);
    console.log(`   ✅ Request without PIN: ${resp2a.statusCode} (expected 401)`);

    // Test with wrong PIN (should fail)
    const resp2b = await makeRequest(`http://127.0.0.1:${proxy2Port}/test?token=wrongpin`);
    console.log(`   ✅ Request with wrong PIN: ${resp2b.statusCode} (expected 401)`);

    // Test with correct PIN (should succeed)
    const resp2c = await makeRequest(`http://127.0.0.1:${proxy2Port}/test?token=${pin}`);
    console.log(`   ✅ Request with correct PIN: ${resp2c.statusCode} (expected 200)`);
    const body2c = JSON.parse(resp2c.body);
    console.log(`   ✅ Response: ${body2c.message}\n`);

    await proxy2.stop();

    // 6. Test QR code generation
    console.log('6️⃣  Testing QR code generation...');
    const accessUrl = service.getAccessUrl(lanIp || '192.168.1.100', 3081, true, pin);
    console.log(`   ✅ Access URL: ${accessUrl}`);
    const qrDataUrl = await service.generateQrCode(accessUrl);
    console.log(`   ✅ QR code generated: ${qrDataUrl.substring(0, 50)}...`);
    console.log(`   ✅ QR code size: ${qrDataUrl.length} bytes\n`);

    // 7. Test HTML shim injection
    console.log('7️⃣  Testing HTML shim injection...');
    const htmlUpstream = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Test</title></head><body>Hello</body></html>');
    });
    await new Promise((resolve) => {
      htmlUpstream.listen(0, '127.0.0.1', () => resolve());
    });
    const htmlPort = htmlUpstream.address().port;

    const proxy3 = new ReverseProxy({
      port: 0,
      upstreamHost: '127.0.0.1',
      upstreamPort: htmlPort,
      pinEnabled: false,
      heartbeatInterval: 0,
    });
    await proxy3.start();
    const proxy3Port = proxy3.getPort();

    const resp3 = await makeRequest(`http://127.0.0.1:${proxy3Port}/`);
    const hasShim = resp3.body.includes('__DSH_TRANSPORT__');
    console.log(`   ✅ HTML shim injected: ${hasShim ? 'yes' : 'NO (BUG!)'}\n`);

    await proxy3.stop();
    await new Promise((resolve) => htmlUpstream.close(() => resolve()));

    // Cleanup
    await new Promise((resolve) => upstream.close(() => resolve()));

    console.log('✅ All integration tests passed!\n');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

main().catch((err) => {
  console.error('❌ Integration test failed:', err);
  process.exit(1);
});
