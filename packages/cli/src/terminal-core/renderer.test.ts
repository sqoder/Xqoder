import { describe, expect, it } from 'vitest';
import { createInitialTerminalAppState } from './app-state.js';
import { reduceEditorModel } from './editor-model.js';
import { renderTerminalFrame } from './renderer.js';

describe('terminal renderer', () => {
    it('renders transcript editor sidebar and status bar into a frame buffer', () => {
        const state = createInitialTerminalAppState({ width: 80, height: 24 });
        state.transcriptLines = ['hello from transcript'];
        state.editor = reduceEditorModel(state.editor, { type: 'insert-text', text: 'draft' });
        state.statusItems = [{ text: 'ready' }, { text: 'gpt-4.1' }];

        const result = renderTerminalFrame(state);
        const lines = result.buffer.toLines();

        // 标题在 titleRow=1；第 0 行为外框阴影。当前布局无侧栏 (SIDEBAR_WIDTH=0)，不渲染 sidebar
        expect(lines.join('\n')).toContain('XQoder');
        expect(lines.join('\n')).toContain('hello from transcript');
        expect(lines.join('\n')).toContain('draft');
        expect(lines.join('\n')).toContain('ready');
    });
});
