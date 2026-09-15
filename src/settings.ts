import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';

/**
 * Generate a cryptographically secure 8-digit PIN.
 */
export function generatePin(): string {
  // Generate 8-digit number (00000000 to 99999999)
  const pin = randomInt(0, 100_000_000);
  return pin.toString().padStart(8, '0');
}

/**
 * Manages PIN persistence for mobile access authentication.
 * Stores PIN in $DSH_HOME/dsh-mobile/token with 0o600 permissions.
 * Also manages enabled state persistence in $DSH_HOME/dsh-mobile/state.json.
 */
export class SettingsManager {
  private readonly settingsDir: string;
  private readonly tokenPath: string;
  private readonly statePath: string;
  private readonly customPin: string | undefined;
  private cachedPin: string | undefined;
  private cachedEnabled: boolean | undefined;

  constructor(dshHome: string, customPin?: string) {
    this.settingsDir = join(dshHome, 'dsh-mobile');
    this.tokenPath = join(this.settingsDir, 'token');
    this.statePath = join(this.settingsDir, 'state.json');
    this.customPin = customPin || undefined;
  }

  /**
   * Get the current PIN. Generates one if it doesn't exist.
   */
  async getPin(): Promise<string> {
    // Return cached PIN if available
    if (this.cachedPin) {
      return this.cachedPin;
    }

    // Try to load existing PIN
    try {
      const existing = await readFile(this.tokenPath, 'utf-8');
      this.cachedPin = existing.trim();
      return this.cachedPin;
    } catch {
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
  async regeneratePin(): Promise<string> {
    const pin = generatePin();
    await this.savePin(pin);
    this.cachedPin = pin;
    return pin;
  }

  /**
   * Get the persisted enabled state. Defaults to true if not set.
   */
  async getEnabled(): Promise<boolean> {
    if (this.cachedEnabled !== undefined) {
      return this.cachedEnabled;
    }

    try {
      const data = await readFile(this.statePath, 'utf-8');
      const state = JSON.parse(data);
      this.cachedEnabled = typeof state.enabled === 'boolean' ? state.enabled : true;
      return this.cachedEnabled;
    } catch {
      // File doesn't exist or invalid, default to true
      this.cachedEnabled = true;
      return true;
    }
  }

  /**
   * Save the enabled state to file.
   */
  async saveEnabled(enabled: boolean): Promise<void> {
    await mkdir(this.settingsDir, { recursive: true });
    await writeFile(this.statePath, JSON.stringify({ enabled }, null, 2), 'utf-8');
    this.cachedEnabled = enabled;
  }

  /**
   * Save PIN to file with restricted permissions.
   */
  private async savePin(pin: string): Promise<void> {
    await mkdir(this.settingsDir, { recursive: true });
    await writeFile(this.tokenPath, pin, 'utf-8');
    await chmod(this.tokenPath, 0o600);
  }
}
