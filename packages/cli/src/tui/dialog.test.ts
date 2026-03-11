import { describe, expect, it } from 'vitest';
import {
    getNextListIndex,
    getVisibleListWindow,
    resolveInitialModelSelection,
    resolveInitialThemeIndex,
} from './dialog.js';

describe('dialog helpers', () => {
    it('wraps list navigation like OpenCode selectors', () => {
        expect(getNextListIndex(0, 4, 'prev')).toBe(3);
        expect(getNextListIndex(3, 4, 'next')).toBe(0);
    });

    it('centers the selected item inside the visible window when possible', () => {
        expect(getVisibleListWindow(20, 0, 10)).toEqual({ start: 0, end: 10 });
        expect(getVisibleListWindow(20, 8, 10)).toEqual({ start: 3, end: 13 });
        expect(getVisibleListWindow(20, 19, 10)).toEqual({ start: 10, end: 20 });
    });

    it('resolves the current theme selection from the available theme names', () => {
        expect(resolveInitialThemeIndex(['xqoder', 'gruvbox', 'nord'], 'gruvbox')).toBe(1);
        expect(resolveInitialThemeIndex(['xqoder', 'gruvbox', 'nord'], 'missing')).toBe(0);
    });

    it('resolves the provider and model index for the active model', () => {
        expect(resolveInitialModelSelection('gpt-4o')).toEqual({
            providerIdx: 1,
            modelIdx: 0,
        });
        expect(resolveInitialModelSelection('claude-opus-4-6')).toEqual({
            providerIdx: 0,
            modelIdx: 0,
        });
        expect(resolveInitialModelSelection('unknown-model')).toEqual({
            providerIdx: 0,
            modelIdx: 0,
        });
    });
});
