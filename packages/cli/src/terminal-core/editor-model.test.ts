import { describe, expect, it } from 'vitest';
import { createEditorModel, getEditorViewModel, reduceEditorModel } from './editor-model.js';

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
});
