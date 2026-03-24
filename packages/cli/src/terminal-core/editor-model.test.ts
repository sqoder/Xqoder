import { describe, expect, it } from 'vitest';
import {
    createEditorModel,
    expandEditorValueForSubmit,
    getEditorViewModel,
    offsetToEditorCursor,
    reduceEditorModel,
} from './editor-model.js';

describe('editor model', () => {
    it('supports insert paste cursor movement and attachments', () => {
        let editor = createEditorModel({ placeholder: 'hello' });
        editor = reduceEditorModel(editor, { type: 'insert-text', text: 'abc' });
        editor = reduceEditorModel(editor, { type: 'paste', text: '\ndef' });
        editor = reduceEditorModel(editor, { type: 'move-vertical', delta: -1 });
        editor = reduceEditorModel(editor, {
            type: 'append-attachment',
            attachment: { id: 'a1', label: 'README.md', kind: 'file' },
        });

        expect(editor.value).toBe('abc\ndef');
        expect(editor.attachments).toHaveLength(1);
        expect(getEditorViewModel(editor).cursor.line).toBe(0);
    });

    it('supports readline-style word navigation and deletion', () => {
        let editor = createEditorModel({ value: 'alpha beta gamma' });

        editor = reduceEditorModel(editor, { type: 'move-word', direction: 'backward' });
        expect(editor.cursorOffset).toBe('alpha beta '.length);

        editor = reduceEditorModel(editor, { type: 'delete-word-backward' });
        expect(editor.value).toBe('alpha gamma');
        expect(editor.cursorOffset).toBe('alpha '.length);

        editor = reduceEditorModel(editor, { type: 'move-word', direction: 'forward' });
        expect(editor.cursorOffset).toBe('alpha gamma'.length);
    });

    it('supports deleting from cursor to line end', () => {
        let editor = createEditorModel({ value: 'hello world\nnext line' });
        editor = reduceEditorModel(editor, { type: 'set-value', value: 'hello world\nnext line', cursorOffset: 'hello '.length });
        editor = reduceEditorModel(editor, { type: 'delete-to-line-end' });

        expect(editor.value).toBe('hello \nnext line');
        expect(editor.cursorOffset).toBe('hello '.length);
    });

    it('tracks CJK and emoji cursor display columns', () => {
        const value = '你a🙂';
        expect(offsetToEditorCursor(value, 1).column).toBe(2);
        expect(offsetToEditorCursor(value, 2).column).toBe(3);
        expect(offsetToEditorCursor(value, 4).column).toBe(5);
    });

    it('keeps attachment pills independent from text edits', () => {
        let editor = createEditorModel({ value: '你好🙂' });
        editor = reduceEditorModel(editor, {
            type: 'append-attachment',
            attachment: { id: 'pill-1', label: '@src/app.ts', kind: 'file' },
        });
        editor = reduceEditorModel(editor, { type: 'move-horizontal', delta: -1 });
        editor = reduceEditorModel(editor, { type: 'delete-backward' });

        expect(editor.value.length).toBeLessThan('你好🙂'.length);
        expect(editor.attachments).toHaveLength(1);
    });

    it('moves and deletes by grapheme cluster for joined emoji', () => {
        const joinedEmoji = '👨‍👩‍👧‍👦';
        let editor = createEditorModel({ value: `A${joinedEmoji}B` });

        editor = reduceEditorModel(editor, { type: 'move-horizontal', delta: -1 });
        expect(editor.cursorOffset).toBe(1 + joinedEmoji.length);

        editor = reduceEditorModel(editor, { type: 'delete-backward' });
        expect(editor.value).toBe('AB');
    });

    it('keeps display-column alignment when moving vertically', () => {
        const value = 'A你B\n12🙂45\n🙂x';
        let editor = createEditorModel({ value });
        editor = reduceEditorModel(editor, { type: 'set-value', value, cursorOffset: 'A你B'.length });

        editor = reduceEditorModel(editor, { type: 'move-vertical', delta: 1 });
        let cursor = offsetToEditorCursor(editor.value, editor.cursorOffset);
        expect(cursor.line).toBe(1);
        expect(cursor.column).toBe(4);

        editor = reduceEditorModel(editor, { type: 'move-vertical', delta: 1 });
        cursor = offsetToEditorCursor(editor.value, editor.cursorOffset);
        expect(cursor.line).toBe(2);
        expect(cursor.column).toBe(3);
    });

    it('keeps sticky desired column across repeated vertical moves', () => {
        const value = 'abcdef\n你🙂\nabcdef';
        let editor = createEditorModel({ value });
        editor = reduceEditorModel(editor, { type: 'set-value', value, cursorOffset: 'abcdef'.length });

        editor = reduceEditorModel(editor, { type: 'move-vertical', delta: 1 });
        let cursor = offsetToEditorCursor(editor.value, editor.cursorOffset);
        expect(cursor.line).toBe(1);
        expect(cursor.column).toBe(4);

        editor = reduceEditorModel(editor, { type: 'move-vertical', delta: 1 });
        cursor = offsetToEditorCursor(editor.value, editor.cursorOffset);
        expect(cursor.line).toBe(2);
        expect(cursor.column).toBe(6);
    });

    it('moves across attachment pills with part cursor semantics', () => {
        let editor = createEditorModel({ value: 'ab' });
        editor = reduceEditorModel(editor, { type: 'append-attachment', attachment: { id: 'p1', label: '@a.ts', kind: 'file' } });
        editor = reduceEditorModel(editor, { type: 'append-attachment', attachment: { id: 'p2', label: '@b.ts', kind: 'file' } });

        editor = reduceEditorModel(editor, { type: 'move-part-boundary', edge: 'start' });
        expect(editor.cursorPartOffset).toBe(0);
        expect(editor.cursorOffset).toBe(0);

        editor = reduceEditorModel(editor, { type: 'move-part-horizontal', delta: 1 });
        expect(editor.cursorPartOffset).toBe(1);
        expect(editor.cursorOffset).toBe(0);

        editor = reduceEditorModel(editor, { type: 'move-part-horizontal', delta: 2 });
        expect(editor.cursorPartOffset).toBe(3);
        expect(editor.cursorOffset).toBe(1);
    });

    it('deletes attachment pill via delete-part-backward', () => {
        let editor = createEditorModel({ value: 'ab' });
        editor = reduceEditorModel(editor, { type: 'append-attachment', attachment: { id: 'p1', label: '@a.ts', kind: 'file' } });
        editor = reduceEditorModel(editor, { type: 'append-attachment', attachment: { id: 'p2', label: '@b.ts', kind: 'file' } });
        editor = reduceEditorModel(editor, { type: 'move-part-boundary', edge: 'start' });
        editor = reduceEditorModel(editor, { type: 'move-part-horizontal', delta: 2 });

        editor = reduceEditorModel(editor, { type: 'delete-part-backward' });
        expect(editor.attachments).toHaveLength(1);
        expect(editor.attachments[0]?.id).toBe('p1');
        expect(editor.cursorPartOffset).toBe(1);
    });

    it('deletes attachment pill via delete-part-forward', () => {
        let editor = createEditorModel({ value: 'ab' });
        editor = reduceEditorModel(editor, { type: 'append-attachment', attachment: { id: 'p1', label: '@a.ts', kind: 'file' } });
        editor = reduceEditorModel(editor, { type: 'append-attachment', attachment: { id: 'p2', label: '@b.ts', kind: 'file' } });
        editor = reduceEditorModel(editor, { type: 'move-part-boundary', edge: 'start' });

        editor = reduceEditorModel(editor, { type: 'delete-part-forward' });
        expect(editor.attachments).toHaveLength(1);
        expect(editor.attachments[0]?.id).toBe('p2');
        expect(editor.cursorPartOffset).toBe(0);
    });

    it('stores large multiline paste as placeholder and expands on submit', () => {
        const pasted = Array.from({ length: 1000 }, (_, i) => `line-${i + 1}`).join('\n');
        let editor = createEditorModel();
        editor = reduceEditorModel(editor, { type: 'paste-as-placeholder', text: pasted });

        expect(editor.value).toContain('[Pasted 1000 lines]');
        expect(editor.pastePlaceholders).toHaveLength(1);
        expect(expandEditorValueForSubmit(editor)).toBe(pasted);
    });
});
