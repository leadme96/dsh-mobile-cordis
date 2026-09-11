import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, name } from '../src/index.ts';
import type { Context } from '@deepseek-ai/cordis';

describe('index', () => {
  let tempDir: string;
  let mockCtx: Partial<Context>;
  let mockEffectDisposers: Array<() => void | Promise<void>>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dsh-mobile-index-test-'));
    mockEffectDisposers = [];

    mockCtx = {
      effect: vi.fn((fn: any) => {
        // Track disposers for cleanup
        return () => {
          mockEffectDisposers.push(fn as any);
        };
      }) as any,
      get: vi.fn((key: string) => {
        if (key === 'desktopProfiles') return undefined;
        return undefined;
      }) as any,
    };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('plugin metadata', () => {
    it('should export plugin name', () => {
      expect(name).toBe('dsh-mobile');
    });
  });

  describe('apply', () => {
    it('should be a function', () => {
      expect(typeof apply).toBe('function');
    });

    it('should register effect for cleanup', () => {
      const config = {
        enabled: true,
        port: 3081,
        upstreamPort: 3080,
        dshHome: tempDir,
        lanIpOverride: '',
        pinEnabled: false,
        customPin: '',
        heartbeatInterval: 30,
      };

      apply(mockCtx as Context, config);

      expect(mockCtx.effect).toHaveBeenCalled();
    });
  });
});
