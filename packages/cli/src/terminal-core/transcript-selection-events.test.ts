import { describe, expect, it } from 'vitest';
import { createTranscriptSelectionEvents, normalizeTranscriptSelection } from './transcript-selection-events.js';

describe('transcript-selection-events', () => {
    it('focuses the end line and emits viewport selection events', () => {
        const [focusEvent, selectionEvent] = createTranscriptSelectionEvents(
            { line: 4, column: 3 },
            { line: 7, column: 9 },
        );

        expect(focusEvent).toEqual({ type: 'viewport.focusLine.set', line: 7 });
        expect(selectionEvent).toEqual({
            type: 'viewport.selection.set',
            selection: {
                start: { line: 4, column: 3 },
                end: { line: 7, column: 9 },
            },
        });
    });

    it('clamps selection points to non-negative integers', () => {
        const [focusEvent, selectionEvent] = createTranscriptSelectionEvents(
            { line: -2.2, column: -8.8 },
            { line: 6.7, column: -3 },
        );

        expect(focusEvent).toEqual({ type: 'viewport.focusLine.set', line: 6 });
        expect(selectionEvent).toEqual({
            type: 'viewport.selection.set',
            selection: {
                start: { line: 0, column: 0 },
                end: { line: 6, column: 0 },
            },
        });
    });

    it('normalizes selection bounds while preserving focus at drag end line', () => {
        const [focusEvent, selectionEvent] = createTranscriptSelectionEvents(
            { line: 10, column: 8 },
            { line: 3, column: 2 },
        );

        expect(focusEvent).toEqual({ type: 'viewport.focusLine.set', line: 3 });
        expect(selectionEvent).toEqual({
            type: 'viewport.selection.set',
            selection: {
                start: { line: 3, column: 2 },
                end: { line: 10, column: 8 },
            },
        });
    });

    it('exports normalized transcript selection as a reusable helper', () => {
        expect(normalizeTranscriptSelection(
            { line: 7, column: 5 },
            { line: 7, column: 1 },
        )).toEqual({
            start: { line: 7, column: 1 },
            end: { line: 7, column: 5 },
        });
    });
});
