import { describe, expect, it } from 'vitest';
import { resolveOverlayHitTestItemCount } from './overlay-hit-test.js';

describe('overlay hit-test geometry', () => {
    it('keeps a minimum item count for overlays that should still expose a box', () => {
        expect(resolveOverlayHitTestItemCount(undefined, 1)).toBe(1);
        expect(resolveOverlayHitTestItemCount(0, 1)).toBe(1);
        expect(resolveOverlayHitTestItemCount(0, 0)).toBe(0);
        expect(resolveOverlayHitTestItemCount(7, 1)).toBe(7);
    });
});
