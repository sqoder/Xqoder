import { describe, expect, it } from 'bun:test';
import {
    formatTerminalInlineValue,
    splitTerminalOutputBuffer,
    truncateTerminalInlineText,
} from '../../../../src/platform/terminal/app/run-terminal-app.js';

describe('terminal scrollback formatting', () => {
    it('normalizes inline values for tool progress', () => {
        expect(formatTerminalInlineValue({ path: 'README.md', recursive: true })).toBe('{"path":"README.md","recursive":true}');
        expect(formatTerminalInlineValue('hello\n\nworld')).toBe('hello world');
    });

    it('truncates long inline text without breaking the line', () => {
        expect(truncateTerminalInlineText('abcdef', 4)).toBe('abc…');
        expect(truncateTerminalInlineText('ok', 4)).toBe('ok');
    });

    it('keeps partial tool output buffered until a full line is available', () => {
        expect(splitTerminalOutputBuffer('line one\npartial', false)).toEqual({
            lines: ['line one'],
            rest: 'partial',
        });

        expect(splitTerminalOutputBuffer('line one\npartial', true)).toEqual({
            lines: ['line one', 'partial'],
            rest: '',
        });
    });
});
