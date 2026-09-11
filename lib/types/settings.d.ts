/**
 * Generate a cryptographically secure 8-digit PIN.
 */
export declare function generatePin(): string;
/**
 * Manages PIN persistence for mobile access authentication.
 * Stores PIN in $DSH_HOME/dsh-mobile/token with 0o600 permissions.
 */
export declare class SettingsManager {
    private readonly settingsDir;
    private readonly tokenPath;
    private readonly customPin;
    private cachedPin;
    constructor(dshHome: string, customPin?: string);
    /**
     * Get the current PIN. Generates one if it doesn't exist.
     */
    getPin(): Promise<string>;
    /**
     * Regenerate the PIN (invalidates previous PIN).
     */
    regeneratePin(): Promise<string>;
    /**
     * Save PIN to file with restricted permissions.
     */
    private savePin;
}
