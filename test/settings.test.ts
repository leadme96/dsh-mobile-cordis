import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsManager, generatePin } from '../src/settings.ts';

describe('settings', () => {
  let tempDir: string;
  let manager: SettingsManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dsh-mobile-test-'));
    manager = new SettingsManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('generatePin', () => {
    it('should generate 8-digit numeric PIN', () => {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{8}$/);
    });

    it('should generate different PINs each time', () => {
      const pins = new Set<string>();
      for (let i = 0; i < 10; i++) {
        pins.add(generatePin());
      }
      expect(pins.size).toBeGreaterThan(1);
    });
  });

  describe('SettingsManager', () => {
    describe('getPin', () => {
      it('should generate and return PIN on first call', async () => {
        const pin = await manager.getPin();
        expect(pin).toMatch(/^\d{8}$/);
      });

      it('should return same PIN on subsequent calls', async () => {
        const pin1 = await manager.getPin();
        const pin2 = await manager.getPin();
        expect(pin1).toBe(pin2);
      });

      it('should persist PIN to file', async () => {
        const pin = await manager.getPin();
        const filePath = join(tempDir, 'dsh-mobile', 'token');
        const content = await readFile(filePath, 'utf-8');
        expect(content).toBe(pin);
      });

      it('should set file permissions to 0o600', async () => {
        await manager.getPin();
        const filePath = join(tempDir, 'dsh-mobile', 'token');
        const stats = await stat(filePath);
        expect(stats.mode & 0o777).toBe(0o600);
      });
    });

    describe('regeneratePin', () => {
      it('should generate new PIN', async () => {
        const pin1 = await manager.getPin();
        const pin2 = await manager.regeneratePin();
        expect(pin2).toMatch(/^\d{8}$/);
        expect(pin2).not.toBe(pin1);
      });

      it('should persist new PIN', async () => {
        const pin1 = await manager.getPin();
        const pin2 = await manager.regeneratePin();
        const pin3 = await manager.getPin();
        expect(pin3).toBe(pin2);
        expect(pin3).not.toBe(pin1);
      });
    });

    describe('with custom PIN', () => {
      it('should use custom PIN if provided', async () => {
        const customManager = new SettingsManager(tempDir, '12345678');
        const pin = await customManager.getPin();
        expect(pin).toBe('12345678');
      });

      it('should persist custom PIN', async () => {
        const customManager = new SettingsManager(tempDir, '87654321');
        await customManager.getPin();
        const filePath = join(tempDir, 'dsh-mobile', 'token');
        const content = await readFile(filePath, 'utf-8');
        expect(content).toBe('87654321');
      });
    });

    describe('loadPin', () => {
      it('should load existing PIN from file', async () => {
        const pin1 = await manager.getPin();
        const newManager = new SettingsManager(tempDir);
        const pin2 = await newManager.getPin();
        expect(pin2).toBe(pin1);
      });
    });

    describe('getEnabled', () => {
      it('should default to true when no state file exists', async () => {
        const enabled = await manager.getEnabled();
        expect(enabled).toBe(true);
      });

      it('should return cached value on subsequent calls', async () => {
        const enabled1 = await manager.getEnabled();
        const enabled2 = await manager.getEnabled();
        expect(enabled1).toBe(enabled2);
      });
    });

    describe('saveEnabled', () => {
      it('should persist enabled state to file', async () => {
        await manager.saveEnabled(false);
        const filePath = join(tempDir, 'dsh-mobile', 'state.json');
        const content = await readFile(filePath, 'utf-8');
        const state = JSON.parse(content);
        expect(state.enabled).toBe(false);
      });

      it('should load saved state with new manager instance', async () => {
        await manager.saveEnabled(false);
        const newManager = new SettingsManager(tempDir);
        const enabled = await newManager.getEnabled();
        expect(enabled).toBe(false);
      });

      it('should toggle between true and false', async () => {
        await manager.saveEnabled(false);
        let enabled = await manager.getEnabled();
        expect(enabled).toBe(false);

        await manager.saveEnabled(true);
        enabled = await manager.getEnabled();
        expect(enabled).toBe(true);
      });
    });

    describe('state persistence across restarts', () => {
      it('should remember disabled state after restart', async () => {
        // Simulate first run: user disables the proxy
        await manager.saveEnabled(false);

        // Simulate restart: new manager instance
        const restartedManager = new SettingsManager(tempDir);
        const enabled = await restartedManager.getEnabled();
        expect(enabled).toBe(false);
      });

      it('should remember enabled state after restart', async () => {
        // Explicitly enable
        await manager.saveEnabled(true);

        // Simulate restart
        const restartedManager = new SettingsManager(tempDir);
        const enabled = await restartedManager.getEnabled();
        expect(enabled).toBe(true);
      });
    });
  });
});
