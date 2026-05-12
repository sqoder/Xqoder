// P23 follow-up — vim visual mode tests.

import { describe, expect, it } from 'bun:test';
import { createVimState } from '../../src/platform/terminal/ink/vim/state.js';
import { processNormalKey, processVisualKey } from '../../src/platform/terminal/ink/vim/transitions.js';

function normalState(cursor = 0, register = '') {
    return { ...createVimState(true), mode: 'normal' as const, cursor, register };
}

describe('processNormalKey — visual mode entry', () => {
    it('v enters visual mode with visualStart = cursor', () => {
        const state = normalState(3);
        const result = processNormalKey('v', 'hello world', state);
        expect(result.state.mode).toBe('visual');
        expect(result.state.visualStart).toBe(3);
        expect(result.state.cursor).toBe(3);
    });

    it('V enters visual mode selecting entire line', () => {
        const state = normalState(3);
        const result = processNormalKey('V', 'hello world', state);
        expect(result.state.mode).toBe('visual');
        expect(result.state.visualStart).toBe(0);
        expect(result.state.cursor).toBe(10); // 'hello world'.length - 1
    });

    it('V on empty string sets cursor to 0', () => {
        const state = normalState(0);
        const result = processNormalKey('V', '', state);
        expect(result.state.mode).toBe('visual');
        expect(result.state.visualStart).toBe(0);
        expect(result.state.cursor).toBe(0);
    });
});

describe('processVisualKey — escape', () => {
    it('Esc returns to normal mode and clears visualStart', () => {
        const state = { ...normalState(3), mode: 'visual' as const, visualStart: 1 };
        const result = processVisualKey('escape', 'hello', state);
        expect(result.state.mode).toBe('normal');
        expect(result.state.visualStart).toBeUndefined();
        expect(result.text).toBe('hello');
    });
});

describe('processVisualKey — motions extend selection', () => {
    it('l moves cursor right, extending selection', () => {
        const state = { ...normalState(2), mode: 'visual' as const, visualStart: 2 };
        const result = processVisualKey('l', 'hello', state);
        expect(result.state.cursor).toBe(3);
        expect(result.state.visualStart).toBe(2);
        expect(result.state.mode).toBe('visual');
    });

    it('h moves cursor left, extending selection backward', () => {
        const state = { ...normalState(4), mode: 'visual' as const, visualStart: 4 };
        const result = processVisualKey('h', 'hello', state);
        expect(result.state.cursor).toBe(3);
        expect(result.state.visualStart).toBe(4);
    });

    it('0 moves cursor to start', () => {
        const state = { ...normalState(4), mode: 'visual' as const, visualStart: 4 };
        const result = processVisualKey('0', 'hello', state);
        expect(result.state.cursor).toBe(0);
        expect(result.state.visualStart).toBe(4);
    });

    it('$ moves cursor to end', () => {
        const state = { ...normalState(0), mode: 'visual' as const, visualStart: 0 };
        const result = processVisualKey('$', 'hello', state);
        expect(result.state.cursor).toBe(4);
        expect(result.state.visualStart).toBe(0);
    });
});

describe('processVisualKey — d deletes selection', () => {
    it('d deletes forward selection', () => {
        // cursor at 2, visualStart at 0 → delete chars 0..2 inclusive
        const state = { ...normalState(2), mode: 'visual' as const, visualStart: 0 };
        const result = processVisualKey('d', 'hello', state);
        expect(result.state.mode).toBe('normal');
        expect(result.text).toBe('lo');
        expect(result.state.register).toBe('hel');
        expect(result.state.visualStart).toBeUndefined();
    });

    it('d deletes backward selection (cursor < visualStart)', () => {
        const state = { ...normalState(0), mode: 'visual' as const, visualStart: 3 };
        const result = processVisualKey('d', 'hello', state);
        expect(result.text).toBe('o');
        expect(result.state.register).toBe('hell');
    });

    it('x also deletes selection', () => {
        const state = { ...normalState(1), mode: 'visual' as const, visualStart: 3 };
        const result = processVisualKey('x', 'hello', state);
        expect(result.text).toBe('ho');
        expect(result.state.register).toBe('ell');
    });

    it('d on single char selection deletes one char', () => {
        const state = { ...normalState(2), mode: 'visual' as const, visualStart: 2 };
        const result = processVisualKey('d', 'hello', state);
        expect(result.text).toBe('helo');
        expect(result.state.register).toBe('l');
    });
});

describe('processVisualKey — y yanks selection', () => {
    it('y yanks selection without modifying text', () => {
        const state = { ...normalState(4), mode: 'visual' as const, visualStart: 0 };
        const result = processVisualKey('y', 'hello', state);
        expect(result.state.mode).toBe('normal');
        expect(result.text).toBe('hello');
        expect(result.state.register).toBe('hello');
        expect(result.state.cursor).toBe(0); // cursor moves to start of selection
    });

    it('y yanks partial selection', () => {
        const state = { ...normalState(2), mode: 'visual' as const, visualStart: 1 };
        const result = processVisualKey('y', 'hello', state);
        // cursor=2, visualStart=1 → slice(1, 3) = 'el' (inclusive both ends)
        expect(result.state.register).toBe('el');
        expect(result.text).toBe('hello');
    });
});

describe('processVisualKey — c changes selection', () => {
    it('c deletes selection and enters insert mode', () => {
        const state = { ...normalState(2), mode: 'visual' as const, visualStart: 0 };
        const result = processVisualKey('c', 'hello', state);
        expect(result.state.mode).toBe('insert');
        expect(result.text).toBe('lo');
        expect(result.state.register).toBe('hel');
        expect(result.enterInsert).toBe(true);
        expect(result.state.cursor).toBe(0);
    });
});

describe('processVisualKey — unknown key is no-op', () => {
    it('unknown key preserves state and text', () => {
        const state = { ...normalState(2), mode: 'visual' as const, visualStart: 1 };
        const result = processVisualKey('z', 'hello', state);
        expect(result.text).toBe('hello');
        expect(result.state.mode).toBe('visual');
        expect(result.state.visualStart).toBe(1);
    });
});

describe('visual mode round-trip: v → motion → d', () => {
    it('v then l then d deletes two chars', () => {
        const text = 'hello world';
        const s0 = normalState(0);

        // Enter visual mode at cursor 0
        const s1 = processNormalKey('v', text, s0);
        expect(s1.state.mode).toBe('visual');

        // Move right to cursor 4 (select 'hello')
        let s = s1;
        for (let i = 0; i < 4; i++) {
            s = processVisualKey('l', text, s.state);
        }
        expect(s.state.cursor).toBe(4);
        expect(s.state.visualStart).toBe(0);

        // Delete selection
        const final = processVisualKey('d', text, s.state);
        expect(final.text).toBe(' world');
        expect(final.state.register).toBe('hello');
        expect(final.state.mode).toBe('normal');
    });
});
