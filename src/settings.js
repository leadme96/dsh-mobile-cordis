import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
/**
 * Generate a cryptographically secure 8-digit PIN.
 */
export function generatePin() {
    // Generate 8-digit number (00000000 to 99999999)
    const pin = randomInt(0, 100_000_000);
    return pin.toString().padStart(8, '0');
}
/**
 * Manages PIN persistence for mobile access authentication.
 * Stores PIN in $DSH_HOME/dsh-mobile/token with 0o600 permissions.
 */
export class SettingsManager {
    settingsDir;
    tokenPath;
    customPin;
    cachedPin;
    constructor(dshHome, customPin) {
        this.settingsDir = join(dshHome, 'dsh-mobile');
        this.tokenPath = join(this.settingsDir, 'token');
        this.customPin = customPin || undefined;
    }
    /**
     * Get the current PIN. Generates one if it doesn't exist.
     */
    async getPin() {
        // Return cached PIN if available
        if (this.cachedPin) {
            return this.cachedPin;
        }
        // Try to load existing PIN
        try {
            const existing = await readFile(this.tokenPath, 'utf-8');
            this.cachedPin = existing.trim();
            return this.cachedPin;
        }
        catch {
            // File doesn't exist, generate new one
        }
        // Generate or use custom PIN
        const pin = this.customPin ?? generatePin();
        await this.savePin(pin);
        this.cachedPin = pin;
        return pin;
    }
    /**
     * Regenerate the PIN (invalidates previous PIN).
     */
    async regeneratePin() {
        const pin = generatePin();
        await this.savePin(pin);
        this.cachedPin = pin;
        return pin;
    }
    /**
     * Save PIN to file with restricted permissions.
     */
    async savePin(pin) {
        await mkdir(this.settingsDir, { recursive: true });
        await writeFile(this.tokenPath, pin, 'utf-8');
        await chmod(this.tokenPath, 0o600);
    }
}
