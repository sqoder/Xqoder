import { describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
    computeLayout: vi.fn(),
}));

vi.mock('../terminal-core/rust-tui.js', () => ({
    rustTui: {
        computeLayout: mocked.computeLayout,
    },
}));

import { createEditorModel } from '../terminal-core/editor-model.js';
import { MouseEditorController } from './mouse-editor-controller.js';

describe('MouseEditorController', () => {
    it('moves the editor cursor from a click inside the input area', () => {
        mocked.computeLayout.mockReturnValue({
            input: { x: 0, y: 10, width: 20, height: 3 },
        });

        const dispatch = vi.fn();
        const controller = new MouseEditorController({ dispatch });
        const editor = createEditorModel({ value: 'hello' });

        const handled = controller.handle(
            { type: 'mouse', kind: 'press', button: 'left', x: 6, y: 12, raw: '' },
            {
                size: { width: 120, height: 30 },
                editor,
            },
        );

        expect(handled).toBe(true);
        expect(mocked.computeLayout).toHaveBeenCalledWith(120, 30, 1);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'editor.set-value',
            value: 'hello',
            cursorOffset: 2,
        });
    });

    it('uses the shared Rust query input normalization for tall editor content', () => {
        mocked.computeLayout.mockReturnValue({
            input: { x: 0, y: 10, width: 20, height: 3 },
        });

        const dispatch = vi.fn();
        const controller = new MouseEditorController({ dispatch });
        const editor = createEditorModel({
            value: Array.from({ length: 20 }, (_, index) => `line-${index}`).join('\n'),
        });

        controller.handle(
            { type: 'mouse', kind: 'press', button: 'left', x: 6, y: 12, raw: '' },
            {
                size: { width: 120, height: 30 },
                editor,
            },
        );

        expect(mocked.computeLayout).toHaveBeenCalledWith(120, 30, 6);
    });
});
