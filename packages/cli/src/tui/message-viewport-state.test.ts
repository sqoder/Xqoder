import { describe, expect, it } from 'vitest';
import {
    buildScrollbarMetrics,
    buildSelectionLineSegments,
    buildTranscriptSelectionText,
    createInitialMessageViewportState,
    hasSelectionDragExceededThreshold,
    moveMessageViewportByHalfPage,
    moveMessageViewportToBottom,
    moveMessageViewportToTop,
    pageMessageViewport,
    resolveTopLineFromScrollbar,
    scrollMessageViewport,
    syncMessageViewport,
} from './message-viewport-state.js';

describe('message viewport state', () => {
    it('keeps bottom follow state synced with content growth', () => {
        const state = syncMessageViewport(createInitialMessageViewportState(), {
            lineCount: 120,
            previousLineCount: 100,
            height: 20,
        });

        expect(state.autoFollow).toBe(true);
        expect(state.topLine).toBe(100);
    });

    it('supports line, page, and jump navigation', () => {
        const base = moveMessageViewportToBottom({
            ...createInitialMessageViewportState(),
            selectionRange: {
                start: { line: 0, column: 0 },
                end: { line: 0, column: 4 },
            },
        }, 120, 20);
        const upOne = scrollMessageViewport(base, -1, 120, 20);
        const pageUp = pageMessageViewport(base, 'up', 120, 20);
        const halfDown = moveMessageViewportByHalfPage(pageUp, 'down', 120, 20);
        const top = moveMessageViewportToTop(base);

        expect(upOne.autoFollow).toBe(false);
        expect(upOne.selectionRange).toBeNull();
        expect(pageUp.topLine).toBeLessThan(base.topLine);
        expect(halfDown.topLine).toBeGreaterThan(pageUp.topLine);
        expect(top.topLine).toBe(0);
    });

    it('computes scrollbar and selection helpers', () => {
        expect(buildScrollbarMetrics(120, 20, 30)).toEqual({
            visible: true,
            thumbTop: 5,
            thumbHeight: 3,
            trackHeight: 20,
        });
        expect(resolveTopLineFromScrollbar(120, 20, 19)).toBe(100);
        expect(buildTranscriptSelectionText(
            ['hello world', 'second line'],
            { line: 0, column: 6 },
            { line: 1, column: 6 },
        )).toBe('world\nsecond');
        expect(buildSelectionLineSegments('hello world', 0, {
            start: { line: 0, column: 6 },
            end: { line: 0, column: 11 },
        })).toEqual({
            before: 'hello ',
            selected: 'world',
            after: '',
        });
        expect(hasSelectionDragExceededThreshold(
            { line: 0, column: 0 },
            { line: 0, column: 1 },
            2,
        )).toBe(false);
    });
});
