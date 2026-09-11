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
  });
});
