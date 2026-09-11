import type { NetworkInterfaceInfo } from 'node:os';
export interface MobileServiceConfig {
    lanIpOverride?: string | undefined;
}
/**
 * Service for LAN IP detection and QR code generation.
 */
export declare class MobileService {
    private readonly config;
    private readonly getInterfaces;
    constructor(config: MobileServiceConfig, getInterfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>);
    /**
     * Detect the LAN IP address for mobile access.
     * Returns override IP if configured, otherwise auto-detects.
     */
    detectLanIp(): string | undefined;
    /**
     * Generate QR code as data URL for the given access URL.
     */
    generateQrCode(url: string, pin?: string): Promise<string>;
    /**
     * Build the access URL with optional PIN token.
     */
    getAccessUrl(lanIp: string, port: number, pinEnabled: boolean, pin?: string): string;
}
