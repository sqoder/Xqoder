// P23b/P23-follow-up — Vim transitions: mode switching and key dispatch.

import type { VimState, VimMode } from './state.js';
import { applyMotion } from './motions.js';
import { applyOperator, pasteRegister, deleteLine, yankLine } from './operators.js';

export interface VimTransitionResult {
    state: VimState;
    text: string;
    /** If true, caller should switch to insert mode */
    enterInsert?: boolean;
    /** If true, caller should submit the prompt */
    submit?: boolean;
}

const MOTIONS = new Set(['h', 'j', 'k', 'l', 'w', 'b', 'e', '0', '$', 'gg', 'G']);
const OPERATORS = new Set(['d', 'y', 'c']);
const INSERT_ENTRY = new Set(['i', 'I', 'a', 'A', 'o', 'O', 's', 'S']);

export function processNormalKey(
    key: string,
    text: string,
    state: VimState,
): VimTransitionResult {
    if (key === 'escape') {
        return { state: { ...state, pendingOperator: undefined }, text };
    }

    // Enter visual mode (char-wise)
    if (key === 'v') {
        return {
            state: { ...state, mode: 'visual', visualStart: state.cursor, pendingOperator: undefined },
            text,
        };
    }

    // Enter visual line mode (V) — for single-line input, select all
    if (key === 'V') {
        return {
            state: { ...state, mode: 'visual', visualStart: 0, cursor: Math.max(0, text.length - 1), pendingOperator: undefined },
            text,
        };
    }

    if (INSERT_ENTRY.has(key)) {
        let cursor = state.cursor;
        let newText = text;

        if (key === 'I') cursor = 0;
        else if (key === 'A') cursor = text.length;
        else if (key === 'a') cursor = Math.min(text.length, state.cursor + 1);
        else if (key === 'o' || key === 'O') { newText = ''; cursor = 0; }
        else if (key === 's') {
            newText = text.slice(0, cursor) + text.slice(cursor + 1);
        } else if (key === 'S') {
            newText = '';
            cursor = 0;
        }

        return {
            state: { ...state, mode: 'insert', cursor, pendingOperator: undefined },
            text: newText,
            enterInsert: true,
        };
    }

    if (state.pendingOperator && MOTIONS.has(key)) {
        const result = applyOperator(state.pendingOperator, key, text, state);
        const newMode: VimMode = state.pendingOperator === 'c' ? 'insert' : 'normal';
        return {
            state: { ...state, mode: newMode, cursor: result.cursor, register: result.register, pendingOperator: undefined },
            text: result.text,
            enterInsert: newMode === 'insert',
        };
    }

    if (OPERATORS.has(key) && !state.pendingOperator) {
        return { state: { ...state, pendingOperator: key }, text };
    }

    if (key === 'd' && state.pendingOperator === 'd') {
        const result = deleteLine(text);
        return { state: { ...state, cursor: 0, register: result.register, pendingOperator: undefined }, text: result.text };
    }
    if (key === 'y' && state.pendingOperator === 'y') {
        const result = yankLine(text, state.cursor);
        return { state: { ...state, register: result.register, pendingOperator: undefined }, text };
    }

    if (key === 'p') {
        const result = pasteRegister(text, state.cursor, state.register, true);
        return { state: { ...state, cursor: result.cursor, pendingOperator: undefined }, text: result.text };
    }
    if (key === 'P') {
        const result = pasteRegister(text, state.cursor, state.register, false);
        return { state: { ...state, cursor: result.cursor, pendingOperator: undefined }, text: result.text };
    }

    if (MOTIONS.has(key)) {
        const newCursor = applyMotion(key, text, state);
        return { state: { ...state, cursor: newCursor, pendingOperator: undefined }, text };
    }

    if (key === 'x') {
        const deleted = text[state.cursor] ?? '';
        const newText = text.slice(0, state.cursor) + text.slice(state.cursor + 1);
        const newCursor = Math.min(state.cursor, newText.length - 1);
        return { state: { ...state, cursor: Math.max(0, newCursor), register: deleted, pendingOperator: undefined }, text: newText };
    }

    return { state: { ...state, pendingOperator: undefined }, text };
}

export function processInsertKey(
    key: string,
    char: string,
    text: string,
    state: VimState,
): VimTransitionResult {
    if (key === 'escape') {
        const newCursor = Math.max(0, state.cursor - 1);
        return { state: { ...state, mode: 'normal', cursor: newCursor }, text };
    }

    if (key === 'backspace') {
        if (state.cursor > 0) {
            const newText = text.slice(0, state.cursor - 1) + text.slice(state.cursor);
            return { state: { ...state, cursor: state.cursor - 1 }, text: newText };
        }
        return { state, text };
    }

    if (key === 'return') {
        return { state, text, submit: true };
    }

    if (char && char.length === 1) {
        const newText = text.slice(0, state.cursor) + char + text.slice(state.cursor);
        return { state: { ...state, cursor: state.cursor + 1 }, text: newText };
    }

    return { state, text };
}

/**
 * Process a key press in vim visual mode.
 * Motions extend the selection; d/y/c/x act on the selected range; Esc exits.
 */
export function processVisualKey(
    key: string,
    text: string,
    state: VimState,
): VimTransitionResult {
    const visualStart = state.visualStart ?? state.cursor;

    if (key === 'escape') {
        return {
            state: { ...state, mode: 'normal', visualStart: undefined, pendingOperator: undefined },
            text,
        };
    }

    // Motions extend selection
    if (MOTIONS.has(key)) {
        const newCursor = applyMotion(key, text, { ...state, visualStart });
        return { state: { ...state, cursor: newCursor, visualStart }, text };
    }

    // d / x: delete selection → normal
    if (key === 'd' || key === 'x') {
        const start = Math.min(visualStart, state.cursor);
        const end = Math.max(visualStart, state.cursor) + 1;
        const deleted = text.slice(start, end);
        const newText = text.slice(0, start) + text.slice(end);
        const newCursor = Math.min(start, Math.max(0, newText.length - 1));
        return {
            state: { ...state, mode: 'normal', cursor: newCursor, register: deleted, visualStart: undefined },
            text: newText,
        };
    }

    // y: yank selection → normal
    if (key === 'y') {
        const start = Math.min(visualStart, state.cursor);
        const end = Math.max(visualStart, state.cursor) + 1;
        const yanked = text.slice(start, end);
        return {
            state: { ...state, mode: 'normal', cursor: start, register: yanked, visualStart: undefined },
            text,
        };
    }

    // c: change selection → insert
    if (key === 'c') {
        const start = Math.min(visualStart, state.cursor);
        const end = Math.max(visualStart, state.cursor) + 1;
        const deleted = text.slice(start, end);
        const newText = text.slice(0, start) + text.slice(end);
        return {
            state: { ...state, mode: 'insert', cursor: start, register: deleted, visualStart: undefined },
            text: newText,
            enterInsert: true,
        };
    }

    return { state: { ...state, visualStart }, text };
}
