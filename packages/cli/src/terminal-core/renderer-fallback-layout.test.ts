import { describe, expect, it } from 'vitest';
import { buildFallbackLayout } from './renderer-fallback-layout.js';

describe('renderer fallback layout', () => {
    it('builds a stable placeholder layout when Rust layout is unavailable', () => {
        const layout = buildFallbackLayout(100, 30);

        expect(layout.header).toEqual({ x: 0, y: 0, width: 100, height: 1 });
        expect(layout.messages).toEqual({ x: 0, y: 1, width: 100, height: 24 });
        expect(layout.messagesScrollbar).toBeNull();
        expect(layout.input).toEqual({ x: 0, y: 25, width: 100, height: 3 });
        expect(layout.footer).toEqual({ x: 0, y: 28, width: 100, height: 2 });
        expect(layout.sidebar).toEqual({ x: 100, y: 0, width: 0, height: 30 });
        expect(layout.hasSidebar).toBe(false);
    });

    it('keeps minimum message height when rows are small', () => {
        const layout = buildFallbackLayout(80, 4);

        expect(layout.messages.height).toBe(1);
        expect(layout.input.y).toBe(1);
        expect(layout.footer.y).toBe(2);
    });
});
