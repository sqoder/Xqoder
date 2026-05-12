// P23 — keybindings, vim, and history search unit tests.

import { describe, expect, it } from 'bun:test';
import { matchKeys, keysMatch } from '../../src/platform/terminal/ink/keybindings/match.js';
import { DEFAULT_KEYBINDINGS } from '../../src/platform/terminal/ink/keybindings/defaults.js';
import { loadUserKeybindings } from '../../src/platform/terminal/ink/keybindings/load-user.js';
import { applyMotion } from '../../src/platform/terminal/ink/vim/motions.js';
import { applyOperator, pasteRegister, deleteLine, yankLine } from '../../src/platform/terminal/ink/vim/operators.js';
import { processNormalKey, processInsertKey } from '../../src/platform/terminal/ink/vim/transitions.js';
import { createVimState } from '../../src/platform/terminal/ink/vim/state.js';
import { fuzzyScore, searchHistory } from '../../src/platform/terminal/ink/components/HistorySearchDialog.js';

// ---------------------------------------------------------------------------
// matchKeys
// ---------------------------------------------------------------------------

describe('matchKeys', () => {
    it('maps ctrl+c', () => {
        expect(matchKeys('c', { ctrl: true })).toEqual(['ctrl+c']);
    });

    it('maps escape', () => {
        expect(matchKeys('', { escape: true })).toEqual(['escape']);
    });

    it('maps return', () => {
        expect(matchKeys('', { return: true })).toEqual(['return']);
    });

    it('maps shift+tab', () => {
        expect(matchKeys('', { shift: true, tab: true })).toEqual(['shift+tab']);
    });

    it('maps up arrow', () => {
        expect(matchKeys('', { upArrow: true })).toEqual(['up']);
    });

    it('maps down arrow', () => {
        expect(matchKeys('', { downArrow: true })).toEqual(['down']);
    });

    it('maps ctrl+r', () => {
        expect(matchKeys('r', { ctrl: true })).toEqual(['ctrl+r']);
    });

    it('maps plain character', () => {
        expect(matchKeys('a', {})).toEqual(['a']);
    });

    it('maps pageup', () => {
        expect(matchKeys('', { pageUp: true })).toEqual(['pageup']);
    });

    it('returns empty for unknown key', () => {
        expect(matchKeys('', {})).toEqual([]);
    });
});

describe('keysMatch', () => {
    it('returns true for matching combo', () => {
        expect(keysMatch('c', { ctrl: true }, ['ctrl+c', 'ctrl+d'])).toBe(true);
    });

    it('returns false for non-matching combo', () => {
        expect(keysMatch('x', { ctrl: true }, ['ctrl+c'])).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// DEFAULT_KEYBINDINGS
// ---------------------------------------------------------------------------

describe('DEFAULT_KEYBINDINGS', () => {
    it('has at least 20 bindings', () => {
        expect(DEFAULT_KEYBINDINGS.length).toBeGreaterThanOrEqual(20);
    });

    it('has cancel binding for ctrl+c', () => {
        const cancel = DEFAULT_KEYBINDINGS.find((b) => b.id === 'cancel');
        expect(cancel?.keys).toContain('ctrl+c');
    });

    it('has history-search binding for ctrl+r', () => {
        const hs = DEFAULT_KEYBINDINGS.find((b) => b.id === 'history-search');
        expect(hs?.keys).toContain('ctrl+r');
    });

    it('has exit binding for ctrl+d', () => {
        const exit = DEFAULT_KEYBINDINGS.find((b) => b.id === 'exit');
        expect(exit?.keys).toContain('ctrl+d');
    });
});

// ---------------------------------------------------------------------------
// loadUserKeybindings
// ---------------------------------------------------------------------------

describe('loadUserKeybindings', () => {
    it('returns defaults when file does not exist', () => {
        const bindings = loadUserKeybindings('/nonexistent/path/keybindings.json');
        expect(bindings).toEqual(DEFAULT_KEYBINDINGS);
    });
});

// ---------------------------------------------------------------------------
// Vim motions
// ---------------------------------------------------------------------------

describe('applyMotion', () => {
    function state(cursor: number) {
        return { ...createVimState(), cursor };
    }

    it('h moves left', () => {
        expect(applyMotion('h', 'hello', state(3))).toBe(2);
    });

    it('h clamps at 0', () => {
        expect(applyMotion('h', 'hello', state(0))).toBe(0);
    });

    it('l moves right', () => {
        expect(applyMotion('l', 'hello', state(2))).toBe(3);
    });

    it('l clamps at end', () => {
        expect(applyMotion('l', 'hello', state(4))).toBe(4);
    });

    it('0 moves to start', () => {
        expect(applyMotion('0', 'hello', state(3))).toBe(0);
    });

    it('$ moves to end', () => {
        expect(applyMotion('$', 'hello', state(0))).toBe(4);
    });

    it('w moves to next word', () => {
        expect(applyMotion('w', 'hello world', state(0))).toBe(6);
    });

    it('b moves to previous word', () => {
        expect(applyMotion('b', 'hello world', state(8))).toBe(6);
    });

    it('gg moves to start', () => {
        expect(applyMotion('gg', 'hello', state(3))).toBe(0);
    });

    it('G moves to end', () => {
        expect(applyMotion('G', 'hello', state(0))).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// Vim operators
// ---------------------------------------------------------------------------

describe('applyOperator', () => {
    function state(cursor: number) {
        return { ...createVimState(), cursor };
    }

    it('d deletes from cursor to motion target', () => {
        const result = applyOperator('d', 'l', 'hello', state(1));
        // cursor=1 ('e'), motion 'l' → target=2 ('l'), deletes slice(1,3)='el'
        expect(result.text).toBe('hlo');
        expect(result.register).toBe('el');
    });

    it('y yanks without modifying text', () => {
        const result = applyOperator('y', 'l', 'hello', state(1));
        expect(result.text).toBe('hello');
        expect(result.register).toBe('el');
    });

    it('c changes (deletes + returns cursor at start)', () => {
        const result = applyOperator('c', 'l', 'hello', state(1));
        // same deletion as 'd': removes 'el', leaves 'hlo'
        expect(result.text).toBe('hlo');
        expect(result.cursor).toBe(1);
    });
});

describe('pasteRegister', () => {
    it('pastes after cursor', () => {
        const result = pasteRegister('hello', 2, 'XY', true);
        expect(result.text).toBe('helXYlo');
    });

    it('pastes before cursor', () => {
        const result = pasteRegister('hello', 2, 'XY', false);
        expect(result.text).toBe('heXYllo');
    });

    it('no-op for empty register', () => {
        const result = pasteRegister('hello', 2, '', true);
        expect(result.text).toBe('hello');
    });
});

describe('deleteLine / yankLine', () => {
    it('deleteLine clears text and saves to register', () => {
        const result = deleteLine('hello world');
        expect(result.text).toBe('');
        expect(result.register).toBe('hello world');
    });

    it('yankLine preserves text and saves to register', () => {
        const result = yankLine('hello world', 3);
        expect(result.text).toBe('hello world');
        expect(result.register).toBe('hello world');
    });
});

// ---------------------------------------------------------------------------
// Vim transitions
// ---------------------------------------------------------------------------

describe('processNormalKey', () => {
    function state(cursor: number) {
        return { ...createVimState(true), mode: 'normal' as const, cursor };
    }

    it('i enters insert mode', () => {
        const result = processNormalKey('i', 'hello', state(2));
        expect(result.state.mode).toBe('insert');
        expect(result.enterInsert).toBe(true);
    });

    it('A enters insert at end', () => {
        const result = processNormalKey('A', 'hello', state(0));
        expect(result.state.mode).toBe('insert');
        expect(result.state.cursor).toBe(5);
    });

    it('x deletes char at cursor', () => {
        const result = processNormalKey('x', 'hello', state(1));
        expect(result.text).toBe('hllo');
        expect(result.state.register).toBe('e');
    });

    it('dd clears line', () => {
        const s = { ...state(0), pendingOperator: 'd' };
        const result = processNormalKey('d', 'hello', s);
        expect(result.text).toBe('');
    });

    it('h moves cursor left', () => {
        const result = processNormalKey('h', 'hello', state(3));
        expect(result.state.cursor).toBe(2);
    });
});

describe('processInsertKey', () => {
    function state(cursor: number) {
        return { ...createVimState(true), mode: 'insert' as const, cursor };
    }

    it('escape returns to normal mode', () => {
        const result = processInsertKey('escape', '', 'hello', state(3));
        expect(result.state.mode).toBe('normal');
    });

    it('backspace deletes previous char', () => {
        const result = processInsertKey('backspace', '', 'hello', state(3));
        expect(result.text).toBe('helo');
        expect(result.state.cursor).toBe(2);
    });

    it('return signals submit', () => {
        const result = processInsertKey('return', '', 'hello', state(5));
        expect(result.submit).toBe(true);
    });

    it('inserts character at cursor', () => {
        const result = processInsertKey('', 'X', 'hello', state(2));
        expect(result.text).toBe('heXllo');
        expect(result.state.cursor).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// History search (fuzzyScore + searchHistory)
// ---------------------------------------------------------------------------

describe('fuzzyScore', () => {
    it('exact substring scores highest', () => {
        const score = fuzzyScore('hello', 'say hello world');
        expect(score).toBeGreaterThan(0);
    });

    it('prefix match scores high', () => {
        const score = fuzzyScore('hel', 'hello world');
        expect(score).toBeGreaterThan(0);
    });

    it('empty query scores 0', () => {
        expect(fuzzyScore('', 'hello')).toBe(0);
    });

    it('unrelated query scores low', () => {
        const score = fuzzyScore('xyz', 'hello world');
        expect(score).toBeLessThan(fuzzyScore('hello', 'hello world'));
    });
});

describe('searchHistory', () => {
    const history = [
        'git commit -m "fix bug"',
        'npm install',
        'bun test',
        'git push origin main',
        'ls -la',
        'cd /tmp',
    ];

    it('returns recent items for empty query', () => {
        const results = searchHistory('', history);
        expect(results.length).toBeGreaterThan(0);
    });

    it('returns matching items for query', () => {
        const results = searchHistory('git', history);
        expect(results.some((r) => r.includes('git'))).toBe(true);
    });

    it('returns empty for no matches', () => {
        const results = searchHistory('xyzzy_nonexistent_command', history);
        expect(results).toHaveLength(0);
    });

    it('respects limit', () => {
        const results = searchHistory('', history, 3);
        expect(results.length).toBeLessThanOrEqual(3);
    });

    it('ranks exact matches first', () => {
        const results = searchHistory('bun test', history);
        expect(results[0]).toBe('bun test');
    });
});
