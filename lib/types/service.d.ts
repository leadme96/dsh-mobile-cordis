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
     * The caller owns the complete URL: DSH's launch token and the optional PIN
     * are both query parameters that must survive verbatim into the QR code.
     */
    generateQrCode(url: string): Promise<string>;
    /**
     * Build the access URL with an optional PIN. The PIN uses the `pin` key —
     * `token` belongs to DSH's own launch-token exchange and must not be reused.
     */
    getAccessUrl(lanIp: string, port: number, pinEnabled: boolean, pin?: string): string;
}
