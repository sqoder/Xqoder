import { describe, expect, it } from 'vitest';
import { sanitizeSingleLineTerminalInput } from './terminal-input.js';

describe('ImeTextInput sanitization', () => {
    it('preserves regular text input', () => {
        expect(sanitizeSingleLineTerminalInput('hello xqoder')).toBe('hello xqoder');
        expect(sanitizeSingleLineTerminalInput('记住标记 A-123')).toBe('记住标记 A-123');
    });

    it('strips bracketed paste markers from terminal paste chunks', () => {
        expect(sanitizeSingleLineTerminalInput('\u001B[200~hello\u001B[201~')).toBe('hello');
        expect(sanitizeSingleLineTerminalInput('[200~hello[201~')).toBe('hello');
        expect(sanitizeSingleLineTerminalInput('[200~')).toBe('');
        expect(sanitizeSingleLineTerminalInput('[201~')).toBe('');
    });

    it('normalizes pasted multiline text into a single line', () => {
        expect(sanitizeSingleLineTerminalInput('line 1\r\nline 2\nline 3\tend')).toBe('line 1 line 2 line 3 end');
    });

    it('removes control characters and ansi escapes that break rendering', () => {
        expect(sanitizeSingleLineTerminalInput('a\u0000b\u001B[31mred\u001B[0m')).toBe('abred');
    });
});
