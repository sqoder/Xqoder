// P23b — Vim operators: text manipulation in normal/visual mode.

import type { VimState } from './state.js';
import { applyMotion } from './motions.js';

export interface OperatorResult {
    text: string;
    cursor: number;
    register: string;
}

/**
 * Apply a vim operator to the text.
 * Returns the new text, cursor position, and register content.
 */
export function applyOperator(
    operator: string,
    motion: string,
    text: string,
    state: VimState,
): OperatorResult {
    const pos = state.cursor;
    const targetPos = applyMotion(motion, text, state);
    const start = Math.min(pos, targetPos);
    const end = Math.max(pos, targetPos) + 1;

    switch (operator) {
        case 'd': {
            // Delete from pos to target
            const deleted = text.slice(start, end);
            const newText = text.slice(0, start) + text.slice(end);
            return { text: newText, cursor: Math.min(start, newText.length - 1), register: deleted };
        }
        case 'y': {
            // Yank (copy) — text unchanged
            const yanked = text.slice(start, end);
            return { text, cursor: pos, register: yanked };
        }
        case 'c': {
            // Change: delete + enter insert mode (caller handles mode switch)
            const deleted = text.slice(start, end);
            const newText = text.slice(0, start) + text.slice(end);
            return { text: newText, cursor: start, register: deleted };
        }
        default:
            return { text, cursor: pos, register: state.register };
    }
}

/**
 * Paste register content at cursor position.
 */
export function pasteRegister(text: string, cursor: number, register: string, after = true): { text: string; cursor: number } {
    if (!register) return { text, cursor };
    const insertAt = after ? cursor + 1 : cursor;
    const newText = text.slice(0, insertAt) + register + text.slice(insertAt);
    return { text: newText, cursor: insertAt + register.length - 1 };
}

/**
 * Delete current line (dd equivalent for single-line: clear all).
 */
export function deleteLine(text: string): { text: string; cursor: number; register: string } {
    return { text: '', cursor: 0, register: text };
}

/**
 * Yank current line (yy equivalent for single-line: yank all).
 */
export function yankLine(text: string, cursor: number): { text: string; cursor: number; register: string } {
    return { text, cursor, register: text };
}
