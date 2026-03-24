import { describe, expect, it } from 'vitest';
import { createSelectionAnchorLifecycle } from './selection-anchor-lifecycle.js';

describe('selection-anchor-lifecycle', () => {
    it('manages press -> drag -> release transitions', () => {
        const lifecycle = createSelectionAnchorLifecycle();
        expect(lifecycle.has()).toBe(false);

        lifecycle.press({ line: 5, column: 7 });
        expect(lifecycle.current()).toEqual({ line: 5, column: 7 });
        expect(lifecycle.has()).toBe(true);

        expect(lifecycle.drag({ line: 8, column: 3 })).toEqual({
            start: { line: 5, column: 7 },
            end: { line: 8, column: 3 },
        });

        expect(lifecycle.release()).toEqual({ line: 5, column: 7 });
        expect(lifecycle.current()).toBeNull();
        expect(lifecycle.has()).toBe(false);
    });

    it('normalizes anchor points and supports clear', () => {
        const lifecycle = createSelectionAnchorLifecycle();
        lifecycle.press({ line: -2.4, column: -9.8 });
        expect(lifecycle.current()).toEqual({ line: 0, column: 0 });
        expect(lifecycle.drag({ line: 6.9, column: -4.5 })).toEqual({
            start: { line: 0, column: 0 },
            end: { line: 6, column: 0 },
        });

        lifecycle.clear();
        expect(lifecycle.current()).toBeNull();
        expect(lifecycle.drag({ line: 1, column: 1 })).toBeNull();
    });
});
