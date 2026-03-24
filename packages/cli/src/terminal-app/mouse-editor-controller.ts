import { getEditorViewModel, characterIndexAtDisplayColumn } from '../terminal-core/editor-model.js';
import type { TerminalInputEvent } from '../terminal-core/input-parser.js';
import { toZeroBasedMousePoint } from '../terminal-core/mouse-geometry.js';
import { createRustLayoutHitTestQuery } from '../terminal-core/rust-layout-hit-test-query.js';

interface MouseEditorControllerDeps {
    dispatch: (event: unknown) => void;
}

export class MouseEditorController {
    constructor(private readonly deps: MouseEditorControllerDeps) {}

    handle(input: TerminalInputEvent, st: any): boolean {
        if (!(input.type === 'mouse' && input.kind === 'press' && input.button === 'left')) {
            return false;
        }

        const point = toZeroBasedMousePoint(input);
        const row = point.row;
        const col = point.col;
        const rustQuery = createRustLayoutHitTestQuery(st);
        const layout = rustQuery.computeBaseLayout();
        if (!layout) return false;

        const editorView = getEditorViewModel(st.editor);
        const contentX = layout.input.x + 1;
        let editorRow = layout.input.y + 1;
        if (st.editor.attachments.length > 0) editorRow += 1;
        const contentWidth = layout.input.width - 4;
        const visibleLines = editorView.visibleLines.length > 0 ? editorView.visibleLines : [st.editor.placeholder];
        const cursorLineIndex = editorView.cursor.line - editorView.visibleStartRow;
        const scrollCol = Math.max(0, editorView.cursor.column - contentWidth + 1);

        if (!(row >= editorRow && row < editorRow + visibleLines.length && col >= contentX)) {
            return false;
        }

        const lineIndex = row - editorRow;
        const displayColInVisible = Math.max(0, col - (contentX + 2));
        const startCol = lineIndex === cursorLineIndex ? scrollCol : 0;
        const fullDisplayCol = startCol + displayColInVisible;
        const lines = st.editor.value.length === 0 ? [''] : st.editor.value.split('\n');
        const logicalLineIndex = editorView.visibleStartRow + lineIndex;
        if (logicalLineIndex >= lines.length) {
            return true;
        }

        const line = lines[logicalLineIndex] ?? '';
        const offsetInLine = characterIndexAtDisplayColumn(line, fullDisplayCol);
        let lineStartOffset = 0;
        for (let i = 0; i < logicalLineIndex; i += 1) {
            lineStartOffset += (lines[i]?.length ?? 0) + 1;
        }
        const newOffset = Math.min(st.editor.value.length, lineStartOffset + offsetInLine);
        this.deps.dispatch({ type: 'editor.set-value', value: st.editor.value, cursorOffset: newOffset });
        return true;
    }
}
