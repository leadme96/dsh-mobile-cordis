import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import type { NetworkInterfaceInfo } from 'node:os';

export interface MobileServiceConfig {
  lanIpOverride?: string | undefined;
}

/**
 * Service for LAN IP detection and QR code generation.
 */
export class MobileService {
  private readonly config: MobileServiceConfig;
  private readonly getInterfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>;

  constructor(
    config: MobileServiceConfig,
    getInterfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces
  ) {
    this.config = config;
    this.getInterfaces = getInterfaces;
  }

  /**
   * Detect the LAN IP address for mobile access.
   * Returns override IP if configured, otherwise auto-detects.
   */
  detectLanIp(): string | undefined {
    // Use override if provided
    if (this.config.lanIpOverride) {
      return this.config.lanIpOverride;
    }

    // Auto-detect from network interfaces
    const interfaces = this.getInterfaces();
    const candidates: Array<{ address: string; score: number }> = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;

      // Skip virtual/VPN interfaces
      const lowerName = name.toLowerCase();
      if (
        lowerName.includes('docker') ||
        lowerName.includes('vmware') ||
        lowerName.includes('virtualbox') ||
        lowerName.includes('vboxnet') ||
        lowerName.includes('tailscale') ||
        lowerName.includes('wsl') ||
        lowerName.includes('veth') ||
        lowerName.includes('br-')
      ) {
        continue;
      }

      for (const addr of addrs) {
        if (addr.family !== 'IPv4' || addr.internal) continue;

        let score = 0;
        const ip = addr.address;

        // RFC1918 private addresses get high score
        if (ip.startsWith('10.')) score += 100;
        else if (ip.startsWith('192.168.')) score += 100;
        else if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) score += 100;
        // CGNAT/Tailscale range (lower priority)
        else if (ip.startsWith('100.')) score += 50;

        // Physical interface names get bonus
        if (
          lowerName.includes('wlan') ||
          lowerName.includes('wifi') ||
          lowerName.includes('ethernet') ||
          lowerName.includes('eth') ||
          lowerName.startsWith('en')
        ) {
          score += 20;
        }

        candidates.push({ address: ip, score });
      }
    }

    if (candidates.length === 0) {
      return undefined;
    }

    // Sort by score descending, return highest
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.address;
  }

  /**
   * Generate QR code as data URL for the given access URL.
   * The caller owns the complete URL: DSH's launch token and the optional PIN
   * are both query parameters that must survive verbatim into the QR code.
   */
  async generateQrCode(url: string): Promise<string> {
    return QRCode.toDataURL(url);
  }

  /**
   * Build the access URL with an optional PIN. The PIN uses the `pin` key —
   * `token` belongs to DSH's own launch-token exchange and must not be reused.
   */
  getAccessUrl(
    lanIp: string,
    port: number,
    pinEnabled: boolean,
    pin?: string
  ): string {
    const baseUrl = `http://${lanIp}:${port}`;
    if (pinEnabled && pin) {
      return `${baseUrl}?pin=${pin}`;
    }
    return baseUrl;
  }
}
