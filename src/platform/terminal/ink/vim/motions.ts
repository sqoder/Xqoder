// P23b — Vim motions: cursor movement in normal mode.

import type { VimState } from './state.js';

/**
 * Apply a vim motion to the cursor position.
 * Returns the new cursor position.
 */
export function applyMotion(motion: string, text: string, state: VimState): number {
    const pos = state.cursor;
    const len = text.length;

    switch (motion) {
        case 'h': return Math.max(0, pos - 1);
        case 'l': return Math.min(len - 1, pos + 1);
        case '0': return 0;
        case '$': return Math.max(0, len - 1);
        case 'w': return wordForward(text, pos);
        case 'b': return wordBackward(text, pos);
        case 'e': return wordEnd(text, pos);
        case 'gg': return 0;
        case 'G': return Math.max(0, len - 1);
        // j/k are no-ops in single-line input
        case 'j':
        case 'k': return pos;
        default: return pos;
    }
}

function isWordChar(ch: string): boolean {
    return /\w/.test(ch);
}

function wordForward(text: string, pos: number): number {
    let i = pos;
    const len = text.length;
    // Skip current word
    while (i < len && isWordChar(text[i]!)) i++;
    // Skip whitespace
    while (i < len && !isWordChar(text[i]!)) i++;
    return Math.min(i, len - 1);
}

function wordBackward(text: string, pos: number): number {
    let i = pos - 1;
    // Skip whitespace
    while (i > 0 && !isWordChar(text[i]!)) i--;
    // Skip word
    while (i > 0 && isWordChar(text[i - 1]!)) i--;
    return Math.max(0, i);
}

function wordEnd(text: string, pos: number): number {
    let i = pos + 1;
    const len = text.length;
    // Skip whitespace
    while (i < len && !isWordChar(text[i]!)) i++;
    // Skip to end of word
    while (i < len - 1 && isWordChar(text[i + 1]!)) i++;
    return Math.min(i, len - 1);
}
