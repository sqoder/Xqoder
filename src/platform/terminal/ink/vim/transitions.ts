// P23b — Vim transitions: mode switching and key dispatch.

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

/**
 * Process a key press in vim normal mode.
 * Returns the new state and text.
 */
export function processNormalKey(
    key: string,
    text: string,
    state: VimState,
): VimTransitionResult {
    // Escape: stay in normal (already there)
    if (key === 'escape') {
        return { state: { ...state, pendingOperator: undefined }, text };
    }

    // Enter insert mode
    if (INSERT_ENTRY.has(key)) {
        let cursor = state.cursor;
        let newText = text;

        if (key === 'I') cursor = 0;
        else if (key === 'A') cursor = text.length;
        else if (key === 'a') cursor = Math.min(text.length, state.cursor + 1);
        else if (key === 'o' || key === 'O') { newText = ''; cursor = 0; }
        else if (key === 's') {
            // Delete char at cursor, enter insert
            newText = text.slice(0, cursor) + text.slice(cursor + 1);
        } else if (key === 'S') {
            // Delete line, enter insert
            newText = '';
            cursor = 0;
        }

        return {
            state: { ...state, mode: 'insert', cursor, pendingOperator: undefined },
            text: newText,
            enterInsert: true,
        };
    }

    // Pending operator + motion
    if (state.pendingOperator && MOTIONS.has(key)) {
        const result = applyOperator(state.pendingOperator, key, text, state);
        const newMode: VimMode = state.pendingOperator === 'c' ? 'insert' : 'normal';
        return {
            state: { ...state, mode: newMode, cursor: result.cursor, register: result.register, pendingOperator: undefined },
            text: result.text,
            enterInsert: newMode === 'insert',
        };
    }

    // Operator prefix (d, y, c)
    if (OPERATORS.has(key) && !state.pendingOperator) {
        return { state: { ...state, pendingOperator: key }, text };
    }

    // dd / yy
    if (key === 'd' && state.pendingOperator === 'd') {
        const result = deleteLine(text);
        return { state: { ...state, cursor: 0, register: result.register, pendingOperator: undefined }, text: result.text };
    }
    if (key === 'y' && state.pendingOperator === 'y') {
        const result = yankLine(text, state.cursor);
        return { state: { ...state, register: result.register, pendingOperator: undefined }, text };
    }

    // Paste
    if (key === 'p') {
        const result = pasteRegister(text, state.cursor, state.register, true);
        return { state: { ...state, cursor: result.cursor, pendingOperator: undefined }, text: result.text };
    }
    if (key === 'P') {
        const result = pasteRegister(text, state.cursor, state.register, false);
        return { state: { ...state, cursor: result.cursor, pendingOperator: undefined }, text: result.text };
    }

    // Motion only
    if (MOTIONS.has(key)) {
        const newCursor = applyMotion(key, text, state);
        return { state: { ...state, cursor: newCursor, pendingOperator: undefined }, text };
    }

    // x: delete char at cursor
    if (key === 'x') {
        const deleted = text[state.cursor] ?? '';
        const newText = text.slice(0, state.cursor) + text.slice(state.cursor + 1);
        const newCursor = Math.min(state.cursor, newText.length - 1);
        return { state: { ...state, cursor: Math.max(0, newCursor), register: deleted, pendingOperator: undefined }, text: newText };
    }

    return { state: { ...state, pendingOperator: undefined }, text };
}

/**
 * Process a key press in vim insert mode.
 * Returns the new state and text.
 */
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
