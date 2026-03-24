import { describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
    computeLayout: vi.fn(),
    hitTest: vi.fn(),
}));

vi.mock('./rust-tui.js', () => ({
    rustTui: {
        computeLayout: mocked.computeLayout,
        hitTest: mocked.hitTest,
    },
}));

import { createRustLayoutHitTestQuery } from './rust-layout-hit-test-query.js';

describe('rust layout hit-test query', () => {
    it('normalizes shared layout and hit-test inputs from state once', () => {
        mocked.computeLayout.mockReturnValue({ messages: { x: 0, y: 1, width: 80, height: 20 } });
        mocked.hitTest.mockReturnValue({ kind: 'message', lineOffset: 3 });

        const query = createRustLayoutHitTestQuery({
            size: { width: 120, height: 30 },
            editor: { value: Array.from({ length: 20 }, (_, index) => `line-${index}`).join('\n') },
            overlay: {
                items: [{ id: 'item-1' }],
                max_width: 36,
            },
        });

        expect(query.inputLines).toBe(6);
        expect(query.overlayItemCount).toBe(1);
        expect(query.overlayMaxWidth).toBe(36);

        query.computeBaseLayout();
        query.computeOverlayLayout();
        query.hitTest(10, 12);

        expect(mocked.computeLayout).toHaveBeenNthCalledWith(1, 120, 30, 6);
        expect(mocked.computeLayout).toHaveBeenNthCalledWith(2, 120, 30, 6, 1, 36);
        expect(mocked.hitTest).toHaveBeenCalledWith(120, 30, 6, 1, 36, 10, 12);
    });

    it('honors minimum overlay item count when an empty overlay still needs a box', () => {
        const query = createRustLayoutHitTestQuery({
            size: { width: 100, height: 24 },
            editor: { value: '' },
            overlay: {
                items: [],
            },
        }, { overlayMinimumItemCount: 1 });

        expect(query.inputLines).toBe(1);
        expect(query.overlayItemCount).toBe(1);
        expect(query.overlayMaxWidth).toBeNull();
    });

    it('supports overriding overlay layout inputs for callers that only know item count', () => {
        mocked.computeLayout.mockReturnValue({ overlay: { x: 10, y: 4, width: 40, height: 11 } });

        const query = createRustLayoutHitTestQuery({
            size: { width: 120, height: 30 },
            editor: { value: '' },
            overlay: null,
        }, {
            overlayItemCount: 10,
            overlayMaxWidth: 44,
        });

        expect(query.overlayItemCount).toBe(10);
        expect(query.overlayMaxWidth).toBe(44);

        query.computeOverlayLayout();
        expect(mocked.computeLayout).toHaveBeenCalledWith(120, 30, 1, 10, 44);
    });
});
