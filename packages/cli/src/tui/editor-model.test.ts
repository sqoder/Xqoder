import { describe, expect, it } from 'vitest';
import {
    deleteBackwardAtOffset,
    insertTextAtOffset,
    moveCursorHorizontal,
    moveCursorVertical,
    offsetToLineColumn,
} from './editor-model.js';

describe('terminal editor model', () => {
    it('inserts pasted multiline text at the cursor offset', () => {
        const result = insertTextAtOffset('hello world', 5, '\n你好\nline 2');
        expect(result.value).toBe('hello\n你好\nline 2 world');
        expect(result.offset).toBe('hello\n你好\nline 2'.length);
    });

    it('deletes across line boundaries', () => {
        const result = deleteBackwardAtOffset('line 1\nline 2', 'line 1\n'.length);
        expect(result.value).toBe('line 1line 2');
        expect(result.offset).toBe('line 1'.length);
    });

    it('moves vertically while preserving preferred column when possible', () => {
        const value = 'short\nmuch longer\nmid';
        const startOffset = 'short\nmuch lo'.length;

        const movedUp = moveCursorVertical(value, startOffset, -1);
        expect(offsetToLineColumn(value, movedUp.offset)).toEqual({ line: 0, column: 5 });

        const movedDown = moveCursorVertical(value, movedUp.offset, 1, movedUp.preferredColumn);
        expect(offsetToLineColumn(value, movedDown.offset)).toEqual({ line: 1, column: 7 });
    });

    it('moves horizontally across newline boundaries', () => {
        const value = 'ab\ncd';
        expect(moveCursorHorizontal(value, 2, 1)).toBe(3);
        expect(moveCursorHorizontal(value, 3, -1)).toBe(2);
    });
});
