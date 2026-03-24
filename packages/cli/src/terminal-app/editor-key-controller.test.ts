import { describe, expect, it, vi } from 'vitest';
import { EditorKeyController } from './editor-key-controller.js';

describe('EditorKeyController', () => {
    it('exits shell mode on escape when input starts with !', () => {
        const dispatch = vi.fn();
        const controller = new EditorKeyController({
            dispatch,
            renderNow: async () => undefined,
            getState: () => ({
                overlay: null,
                editor: { value: '!ls -la' },
            }),
            settingsDir: '/repo',
            parsePatchedPathFromLine: () => undefined,
            loadFilepickerEntries: () => [],
            readClipboard: () => undefined,
            showPasteHint: () => undefined,
            submitEditor: async () => undefined,
            setEnterSubmitTimer: () => undefined,
            stdout: process.stdout,
            enterSubmitDelayMs: 120,
        });

        const result = controller.handle({ type: 'key', key: 'escape', raw: '' }, {
            vimMode: 'insert',
            sawFollowUpAfterEnter: false,
            enterSubmitTimer: null,
        });

        expect(result.handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'editor.set-value', value: 'ls -la', cursorOffset: 0 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'notice.set', notice: 'Shell mode disabled' });
    });
});
