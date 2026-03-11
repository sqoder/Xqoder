import { describe, expect, it } from 'vitest';
import {
    buildScrollbarModel,
    buildViewportSelectedText,
    createViewportModel,
    moveViewportModelToBottom,
    pageViewportModel,
    resolveViewportTopLineFromScrollbar,
    scrollViewportModel,
} from './viewport-model.js';

describe('viewport model', () => {
    it('scrolls and computes scrollbars', () => {
        const base = moveViewportModelToBottom(createViewportModel(), 120, 20);
        const up = scrollViewportModel(base, -3, 120, 20);

        expect(up.autoFollow).toBe(false);
        expect(buildScrollbarModel(120, 20, up.topLine).visible).toBe(true);
        expect(resolveViewportTopLineFromScrollbar(120, 20, 19)).toBeGreaterThan(0);
        expect(pageViewportModel(base, 'up', 120, 20).topLine).toBeLessThan(base.topLine);
    });

    it('extracts selected text across lines', () => {
        expect(buildViewportSelectedText(
            ['hello world', 'second line'],
            {
                start: { line: 0, column: 6 },
                end: { line: 1, column: 6 },
            },
        )).toBe('world\nsecond');
    });
});
