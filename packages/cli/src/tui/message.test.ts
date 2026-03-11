import { describe, expect, it } from 'vitest';
import { buildEmptyStateLines, buildScrollbarMetrics, buildTranscriptSelectionText, resolveTopLineFromScrollbar, shouldEnableMouseCapture } from './message.js';

describe('message viewport mouse capture', () => {
    it('enables app-level mouse capture only in app mode', () => {
        expect(shouldEnableMouseCapture('app')).toBe(true);
        expect(shouldEnableMouseCapture('terminal')).toBe(false);
    });

    it('builds an OpenCode-style empty state prompt', () => {
        expect(buildEmptyStateLines(48)).toEqual([
            'XQoder',
            'Ask for code changes, repo explanations, ...',
            'Try /help, /session list, /diff, /timelin...',
        ]);
    });

    it('builds scrollbar thumb metrics for long transcripts', () => {
        expect(buildScrollbarMetrics(120, 20, 30)).toEqual({
            visible: true,
            thumbTop: 5,
            thumbHeight: 3,
            trackHeight: 20,
        });
    });

    it('maps scrollbar pointer rows back into transcript offsets', () => {
        expect(resolveTopLineFromScrollbar(120, 20, 0)).toBe(0);
        expect(resolveTopLineFromScrollbar(120, 20, 10)).toBeGreaterThan(0);
        expect(resolveTopLineFromScrollbar(120, 20, 19)).toBe(100);
    });

    it('copies multi-line transcript selections with start and end columns', () => {
        expect(buildTranscriptSelectionText(
            ['hello world', 'second line', 'third line'],
            { line: 0, column: 6 },
            { line: 1, column: 6 },
        )).toBe('world\nsecond');
    });
});
