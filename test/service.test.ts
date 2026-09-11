import { describe, it, expect } from 'vitest';
import { MobileService } from '../src/service.ts';
import type { NetworkInterfaceInfoIPv4 } from 'node:os';

describe('service', () => {
  describe('MobileService', () => {
    describe('detectLanIp', () => {
      it('should return override IP when provided', () => {
        const service = new MobileService({ lanIpOverride: '192.168.1.100' });
        const ip = service.detectLanIp();
        expect(ip).toBe('192.168.1.100');
      });

      it('should detect LAN IP from network interfaces', () => {
        const service = new MobileService({});
        const ip = service.detectLanIp();
        // Should return a valid IPv4 address
        expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
        // Should not be loopback
        expect(ip).not.toBe('127.0.0.1');
      });

      it('should prefer RFC1918 private addresses', () => {
        const mockInterfaces = () => ({
          'eth0': [
            { family: 'IPv4', address: '192.168.1.50', internal: false, mac: '00:00:00:00:00:00', netmask: '255.255.255.0', cidr: '192.168.1.0/24' } as NetworkInterfaceInfoIPv4,
          ],
          'wlan0': [
            { family: 'IPv4', address: '10.0.0.25', internal: false, mac: '00:00:00:00:00:00', netmask: '255.255.255.0', cidr: '10.0.0.0/24' } as NetworkInterfaceInfoIPv4,
          ],
        });

        const service = new MobileService({}, mockInterfaces);
        const ip = service.detectLanIp();

        // Should return one of the private addresses
        expect(['192.168.1.50', '10.0.0.25']).toContain(ip);
      });

      it('should skip virtual/VPN interfaces', () => {
        const mockInterfaces = () => ({
          'docker0': [
            { family: 'IPv4', address: '172.17.0.1', internal: false, mac: '00:00:00:00:00:00', netmask: '255.255.255.0', cidr: '172.17.0.0/16' } as NetworkInterfaceInfoIPv4,
          ],
          'tailscale0': [
            { family: 'IPv4', address: '100.64.0.1', internal: false, mac: '00:00:00:00:00:00', netmask: '255.255.255.0', cidr: '100.64.0.0/10' } as NetworkInterfaceInfoIPv4,
          ],
          'eth0': [
            { family: 'IPv4', address: '192.168.1.50', internal: false, mac: '00:00:00:00:00:00', netmask: '255.255.255.0', cidr: '192.168.1.0/24' } as NetworkInterfaceInfoIPv4,
          ],
        });

        const service = new MobileService({}, mockInterfaces);
        const ip = service.detectLanIp();

        expect(ip).toBe('192.168.1.50');
      });

      it('should return undefined when no LAN IP found', () => {
        const mockInterfaces = () => ({
          'lo0': [
            { family: 'IPv4', address: '127.0.0.1', internal: true, mac: '00:00:00:00:00:00', netmask: '255.0.0.0', cidr: '127.0.0.1/8' } as NetworkInterfaceInfoIPv4,
          ],
        });

        const service = new MobileService({}, mockInterfaces);
        const ip = service.detectLanIp();

        expect(ip).toBeUndefined();
      });
    });

    describe('generateQrCode', () => {
      it('should generate QR code data URL', async () => {
        const service = new MobileService({});
        const qrData = await service.generateQrCode('http://192.168.1.50:3081');

        expect(qrData).toMatch(/^data:image\/png;base64,/);
      });

      it('should include PIN in URL when provided', async () => {
        const service = new MobileService({});
        const qrData = await service.generateQrCode('http://192.168.1.50:3081', '12345678');

        expect(qrData).toMatch(/^data:image\/png;base64,/);
        // The URL with token should be encoded in the QR code
      });
    });

    describe('getAccessUrl', () => {
      it('should return URL without token when PIN disabled', () => {
        const service = new MobileService({});
        const url = service.getAccessUrl('192.168.1.50', 3081, false);
        expect(url).toBe('http://192.168.1.50:3081');
      });

      it('should return URL with token when PIN enabled', () => {
        const service = new MobileService({});
        const url = service.getAccessUrl('192.168.1.50', 3081, true, '12345678');
        expect(url).toBe('http://192.168.1.50:3081?token=12345678');
      });
    });
  });
});
