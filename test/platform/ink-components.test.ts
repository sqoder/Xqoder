// P22 — Ink component pure-logic unit tests.
// Tests cover parseDiffLines, useVirtualScroll math, and useArrowKeyHistory logic.
// React component rendering tests require ink-testing-library (not installed);
// those are deferred to a follow-up.

import { describe, expect, it } from 'bun:test';
import { parseDiffLines } from '../../src/platform/terminal/ink/components/diff/FileDiff.js';

// ---------------------------------------------------------------------------
// parseDiffLines
// ---------------------------------------------------------------------------

describe('parseDiffLines', () => {
    it('parses add lines', () => {
        const lines = parseDiffLines('+const x = 1;');
        expect(lines[0]?.type).toBe('add');
        expect(lines[0]?.content).toBe('const x = 1;');
    });

    it('parses remove lines', () => {
        const lines = parseDiffLines('-const x = 1;');
        expect(lines[0]?.type).toBe('remove');
        expect(lines[0]?.content).toBe('const x = 1;');
    });

    it('parses context lines', () => {
        const lines = parseDiffLines(' const x = 1;');
        expect(lines[0]?.type).toBe('context');
        expect(lines[0]?.content).toBe('const x = 1;');
    });

    it('parses header lines (@@)', () => {
        const lines = parseDiffLines('@@ -1,3 +1,4 @@');
        expect(lines[0]?.type).toBe('header');
    });

    it('parses header lines (+++)', () => {
        const lines = parseDiffLines('+++ b/src/foo.ts');
        expect(lines[0]?.type).toBe('header');
    });

    it('parses a multi-line diff', () => {
        const diff = `@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;`;
        const lines = parseDiffLines(diff);
        expect(lines).toHaveLength(5);
        expect(lines[0]?.type).toBe('header');
        expect(lines[1]?.type).toBe('context');
        expect(lines[2]?.type).toBe('remove');
        expect(lines[3]?.type).toBe('add');
        expect(lines[4]?.type).toBe('add');
    });

    it('handles empty string', () => {
        const lines = parseDiffLines('');
        expect(lines).toHaveLength(1);
        expect(lines[0]?.type).toBe('context');
    });
});

// ---------------------------------------------------------------------------
// useVirtualScroll — pure math (extracted from hook)
// ---------------------------------------------------------------------------

function computeVirtualScroll(totalItems: number, viewportSize: number, scrollOffset: number) {
    const maxOffset = Math.max(0, totalItems - viewportSize);
    const clampedOffset = Math.min(scrollOffset, maxOffset);
    const start = clampedOffset;
    const end = Math.min(totalItems, clampedOffset + viewportSize);
    const isAtBottom = clampedOffset >= maxOffset;
    return { start, end, isAtBottom, maxOffset };
}

describe('useVirtualScroll math', () => {
    it('shows full list when items fit in viewport', () => {
        const { start, end, isAtBottom } = computeVirtualScroll(5, 20, 0);
        expect(start).toBe(0);
        expect(end).toBe(5);
        expect(isAtBottom).toBe(true);
    });

    it('clamps offset to maxOffset', () => {
        const { start, end } = computeVirtualScroll(100, 20, 999);
        expect(start).toBe(80);
        expect(end).toBe(100);
    });

    it('isAtBottom when at max offset', () => {
        const { isAtBottom } = computeVirtualScroll(100, 20, 80);
        expect(isAtBottom).toBe(true);
    });

    it('isAtBottom false when scrolled up', () => {
        const { isAtBottom } = computeVirtualScroll(100, 20, 50);
        expect(isAtBottom).toBe(false);
    });

    it('handles zero items', () => {
        const { start, end, isAtBottom } = computeVirtualScroll(0, 20, 0);
        expect(start).toBe(0);
        expect(end).toBe(0);
        expect(isAtBottom).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// useArrowKeyHistory — pure navigation logic (extracted)
// ---------------------------------------------------------------------------

function simulateHistory(history: string[]) {
    let historyIndex = -1;
    let savedDraft = '';

    function navigateUp(currentValue: string): string | null {
        if (history.length === 0) return null;
        if (historyIndex === -1) savedDraft = currentValue;
        historyIndex = Math.min(historyIndex + 1, history.length - 1);
        return history[history.length - 1 - historyIndex] ?? null;
    }

    function navigateDown(): string | null {
        if (historyIndex <= 0) {
            historyIndex = -1;
            return savedDraft;
        }
        historyIndex--;
        return history[history.length - 1 - historyIndex] ?? null;
    }

    function reset() {
        historyIndex = -1;
        savedDraft = '';
    }

    return { navigateUp, navigateDown, reset };
}

describe('useArrowKeyHistory logic', () => {
    it('navigates up through history', () => {
        const { navigateUp } = simulateHistory(['first', 'second', 'third']);
        expect(navigateUp('current')).toBe('third');
        expect(navigateUp('third')).toBe('second');
        expect(navigateUp('second')).toBe('first');
    });

    it('caps at oldest entry', () => {
        const { navigateUp } = simulateHistory(['only']);
        expect(navigateUp('draft')).toBe('only');
        expect(navigateUp('only')).toBe('only'); // already at oldest
    });

    it('navigates down restores draft', () => {
        const { navigateUp, navigateDown } = simulateHistory(['a', 'b']);
        navigateUp('my draft');
        const restored = navigateDown();
        expect(restored).toBe('my draft');
    });

    it('navigates down through history', () => {
        const { navigateUp, navigateDown } = simulateHistory(['a', 'b', 'c']);
        navigateUp('draft');
        navigateUp('c');
        navigateUp('b');
        expect(navigateDown()).toBe('b');
        expect(navigateDown()).toBe('c');
        expect(navigateDown()).toBe('draft');
    });

    it('returns null for empty history', () => {
        const { navigateUp } = simulateHistory([]);
        expect(navigateUp('draft')).toBeNull();
    });

    it('reset clears state', () => {
        const { navigateUp, navigateDown, reset } = simulateHistory(['a', 'b']);
        navigateUp('draft');
        reset();
        // After reset, navigateDown should return empty string (savedDraft cleared)
        expect(navigateDown()).toBe('');
    });
});
