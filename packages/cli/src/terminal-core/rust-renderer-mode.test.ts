import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRendererMode } from './rust-renderer.js';

describe('renderer mode', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('defaults to auto when env is missing', () => {
        vi.stubEnv('XQODER_RENDERER_MODE', undefined);
        expect(getRendererMode()).toBe('auto');
    });

    it('accepts rust and fallback modes', () => {
        vi.stubEnv('XQODER_RENDERER_MODE', 'rust');
        expect(getRendererMode()).toBe('rust');
        vi.stubEnv('XQODER_RENDERER_MODE', 'fallback');
        expect(getRendererMode()).toBe('fallback');
    });

    it('falls back to auto on invalid env', () => {
        vi.stubEnv('XQODER_RENDERER_MODE', 'broken');
        expect(getRendererMode()).toBe('auto');
    });
});
