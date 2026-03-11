import { describe, expect, it } from 'vitest';
import { createInitialMessageViewportState } from './message-viewport-state.js';
import { handleViewportMouseEvent } from './message-viewport-controller.js';

describe('message viewport controller', () => {
    const transcriptLines = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`);

    it('scrolls with mouse wheel events', () => {
        const result = handleViewportMouseEvent({
            code: 64,
            x: 1,
            y: 1,
            action: 'press',
        }, {
            state: createInitialMessageViewportState(),
            transcriptLines,
            height: 20,
            contentWidth: 50,
            visibleLines: transcriptLines.slice(100, 120),
            topLine: 100,
            maxTopLine: 100,
            mouseScrollStep: 3,
            visibleLineCount: 20,
            scrollbarMetrics: { visible: true, thumbTop: 5, thumbHeight: 3 },
            scrollbarWidth: 3,
            scrollbarGrabSlop: 2,
            scrollbarAnchor: { x: 90, y: 0 },
            transcriptAnchor: { x: 0, y: 0 },
            draggingScrollbar: false,
            scrollbarDragOffset: 0,
            draggingSelection: false,
            selectionStart: null,
            selectionRange: null,
            selectionDragThreshold: 2,
        });

        expect(result.handled).toBe(true);
        expect(result.nextState.autoFollow).toBe(false);
    });

    it('enters scrollbar drag mode only when the thumb is hit', () => {
        const result = handleViewportMouseEvent({
            code: 0,
            x: 91,
            y: 7,
            action: 'press',
        }, {
            state: createInitialMessageViewportState(),
            transcriptLines,
            height: 20,
            contentWidth: 50,
            visibleLines: transcriptLines.slice(30, 50),
            topLine: 30,
            maxTopLine: 100,
            mouseScrollStep: 3,
            visibleLineCount: 20,
            scrollbarMetrics: { visible: true, thumbTop: 5, thumbHeight: 3 },
            scrollbarWidth: 3,
            scrollbarGrabSlop: 2,
            scrollbarAnchor: { x: 90, y: 0 },
            transcriptAnchor: { x: 0, y: 0 },
            draggingScrollbar: false,
            scrollbarDragOffset: 0,
            draggingSelection: false,
            selectionStart: null,
            selectionRange: null,
            selectionDragThreshold: 2,
        });

        expect(result.draggingScrollbar).toBe(true);
        expect(result.scrollbarDragOffset).toBe(1);
    });

    it('produces copied text on selection release', () => {
        const result = handleViewportMouseEvent({
            code: 0,
            x: 8,
            y: 2,
            action: 'release',
        }, {
            state: {
                ...createInitialMessageViewportState(),
                autoFollow: false,
                selectionRange: null,
            },
            transcriptLines,
            height: 20,
            contentWidth: 50,
            visibleLines: transcriptLines.slice(0, 20),
            topLine: 0,
            maxTopLine: 100,
            mouseScrollStep: 3,
            visibleLineCount: 20,
            scrollbarMetrics: { visible: true, thumbTop: 0, thumbHeight: 3 },
            scrollbarWidth: 3,
            scrollbarGrabSlop: 2,
            scrollbarAnchor: { x: 90, y: 0 },
            transcriptAnchor: { x: 0, y: 0 },
            draggingScrollbar: false,
            scrollbarDragOffset: 0,
            draggingSelection: true,
            selectionStart: { line: 0, column: 0 },
            selectionRange: { start: { line: 0, column: 0 }, end: { line: 0, column: 4 } },
            selectionDragThreshold: 2,
        });

        expect(result.copiedText).toBe('line 1\nline 2');
        expect(result.draggingSelection).toBe(false);
    });

    it('clamps release points outside the transcript to the last visible row', () => {
        const result = handleViewportMouseEvent({
            code: 0,
            x: 80,
            y: 40,
            action: 'release',
        }, {
            state: {
                ...createInitialMessageViewportState(),
                autoFollow: false,
                selectionRange: null,
            },
            transcriptLines,
            height: 20,
            contentWidth: 50,
            visibleLines: transcriptLines.slice(10, 30),
            topLine: 10,
            maxTopLine: 100,
            mouseScrollStep: 3,
            visibleLineCount: 20,
            scrollbarMetrics: { visible: true, thumbTop: 0, thumbHeight: 3 },
            scrollbarWidth: 3,
            scrollbarGrabSlop: 2,
            scrollbarAnchor: { x: 90, y: 0 },
            transcriptAnchor: { x: 0, y: 0 },
            draggingScrollbar: false,
            scrollbarDragOffset: 0,
            draggingSelection: true,
            selectionStart: { line: 10, column: 0 },
            selectionRange: { start: { line: 10, column: 0 }, end: { line: 10, column: 3 } },
            selectionDragThreshold: 2,
        });

        expect(result.copiedText).toContain('line 11');
        expect(result.selectionRange?.end.line).toBe(29);
    });

    it('does not copy when the drag threshold is not exceeded', () => {
        const result = handleViewportMouseEvent({
            code: 32,
            x: 2,
            y: 1,
            action: 'press',
        }, {
            state: createInitialMessageViewportState(),
            transcriptLines,
            height: 20,
            contentWidth: 50,
            visibleLines: transcriptLines.slice(0, 20),
            topLine: 0,
            maxTopLine: 100,
            mouseScrollStep: 3,
            visibleLineCount: 20,
            scrollbarMetrics: { visible: true, thumbTop: 0, thumbHeight: 3 },
            scrollbarWidth: 3,
            scrollbarGrabSlop: 2,
            scrollbarAnchor: { x: 90, y: 0 },
            transcriptAnchor: { x: 0, y: 0 },
            draggingScrollbar: false,
            scrollbarDragOffset: 0,
            draggingSelection: true,
            selectionStart: { line: 0, column: 0 },
            selectionRange: null,
            selectionDragThreshold: 2,
        });

        expect(result.selectionRange).toBeNull();
        expect(result.copiedText).toBeUndefined();
    });
});
