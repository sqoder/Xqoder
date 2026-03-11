import { describe, expect, it } from 'vitest';
import {
    sanitizeMultiLineTerminalInput,
    sanitizeSingleLineTerminalInput,
} from './terminal-input.js';

describe('terminal input sanitization', () => {
    it('preserves ordinary unicode input', () => {
        expect(sanitizeMultiLineTerminalInput('hello xqoder')).toBe('hello xqoder');
        expect(sanitizeMultiLineTerminalInput('记住标记 A-123')).toBe('记住标记 A-123');
    });

    it('removes bracketed paste markers and ansi sequences', () => {
        expect(sanitizeMultiLineTerminalInput('\u001B[200~hello\u001B[31m red\u001B[0m\u001B[201~')).toBe('hello red');
    });

    it('keeps newlines for multiline editor input while normalizing carriage returns and tabs', () => {
        expect(sanitizeMultiLineTerminalInput('line 1\r\nline 2\nline 3\tend')).toBe('line 1\nline 2\nline 3 end');
    });

    it('collapses multiline text for single-line inputs', () => {
        expect(sanitizeSingleLineTerminalInput('line 1\r\nline 2\nline 3\tend')).toBe('line 1 line 2 line 3 end');
    });
});
