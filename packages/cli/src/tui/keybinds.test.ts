import { describe, expect, it } from 'vitest';
import { resolveKeybinds } from './keybinds.js';

describe('tui keybinds', () => {
    it('matches dedicated timeline navigation and panel focus keybind actions', () => {
        const keybinds = resolveKeybinds();

        expect(keybinds.matchAction('j', { ctrl: true, meta: false, shift: false, tab: false })).toBe('timelineNext');
        expect(keybinds.matchAction('k', { ctrl: true, meta: false, shift: true, tab: false })).toBe('timelinePrev');
        expect(keybinds.matchAction('u', { ctrl: true, meta: false, shift: false, tab: false })).toBe('timelineToggle');
        expect(keybinds.matchAction(']', { ctrl: true, meta: false, shift: false, tab: false })).toBe('panelNext');
        expect(keybinds.matchAction('[', { ctrl: true, meta: false, shift: false, tab: false })).toBe('panelPrev');
    });
});
