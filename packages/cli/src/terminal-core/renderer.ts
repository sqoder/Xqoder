import { getEditorViewModel } from './editor-model.js';
import { ScreenBuffer, type CellStyle } from './screen-buffer.js';
import { buildScrollbarModel, getViewportVisibleLines } from './viewport-model.js';
import type { TerminalAppState } from './app-state.js';
import type { TerminalTheme } from './renderer-boxes.js';
import {
    DEFAULT_TERMINAL_THEME,
    renderOuterFrameBox,
    renderTranscriptBox,
    renderEditorBox,
    renderSidebarBox,
    renderStatusBox,
    renderOuterScrollbarBox,
    type LayoutMetrics,
} from './renderer-boxes.js';

export type { TerminalTheme } from './renderer-boxes.js';
export { DEFAULT_TERMINAL_THEME } from './renderer-boxes.js';

/** 仿 Claude Code：无右侧边栏。整屏为一个大 Box，内部再分功能 Box。 */
const SIDEBAR_WIDTH = 0;

export interface RenderFrameResult {
    buffer: ScreenBuffer;
    transcriptHeight: number;
    sidebarWidth: number;
    cursor: {
        x: number;
        y: number;
        visible: boolean;
    };
}

function computeLayout(state: TerminalAppState): LayoutMetrics {
    const width = state.size.width;
    const height = state.size.height;
    const innerWidth = Math.max(20, width - 2);
    const innerHeight = Math.max(10, height - 2);
    const editorView = getEditorViewModel(state.editor);
    const editorHeight = Math.max(3, editorView.visibleLines.length + state.editor.attachments.length + 2);
    const transcriptHeight = Math.max(5, height - 7 - editorHeight);
    const titleRow = 1;
    const separatorRow1 = 2;
    const transcriptStartRow = 3;
    const separatorRow2 = 3 + transcriptHeight;
    const editorY = 4 + transcriptHeight;
    const statusRow = height - 2;

    return {
        mainWidth: innerWidth,
        sidebarWidth: SIDEBAR_WIDTH,
        transcriptHeight,
        transcriptContentWidth: innerWidth - 1,
        scrollbarCol: innerWidth,
        editorY,
        editorHeight,
        statusY: statusRow,
        statusHeight: 1,
        sidebarX: innerWidth,
        outerScrollbarCol: -1,
        innerLeft: 1,
        innerTop: 1,
        innerWidth,
        innerHeight,
        titleRow,
        separatorRow1,
        transcriptStartRow,
        separatorRow2,
        statusRow,
    };
}

export function renderTerminalFrame(state: TerminalAppState, theme: TerminalTheme = DEFAULT_TERMINAL_THEME): RenderFrameResult {
    const buffer = ScreenBuffer.empty(state.size, theme.background);
    const layout = computeLayout(state);

    renderOuterFrameBox(buffer, state, layout, theme);
    renderTranscriptBox(buffer, state, layout, theme);
    renderEditorBox(buffer, state, layout, theme);
    if (layout.sidebarWidth > 0) {
        renderSidebarBox(buffer, state, layout, theme);
        renderOuterScrollbarBox(buffer, state, layout, theme);
    }
    renderStatusBox(buffer, state, layout, theme);

    const editorView = getEditorViewModel(state.editor);
    const editorLines = editorView.visibleLines.length > 0 ? editorView.visibleLines : [state.editor.placeholder];
    const contentX = (layout.innerLeft ?? 0) + 1;
    let editorRow = layout.editorY + 1;
    if (state.editor.attachments.length > 0) editorRow += 1;
    const cursorRow = editorRow + Math.max(0, Math.min(editorView.cursor.line - editorView.visibleStartRow, editorLines.length - 1));
    const cursorColumn = contentX + 2 + editorView.cursor.column;

    return {
        buffer,
        transcriptHeight: layout.transcriptHeight,
        sidebarWidth: layout.sidebarWidth,
        cursor: {
            x: Math.min(buffer.width - 1, cursorColumn),
            y: Math.min(buffer.height - 1, cursorRow),
            visible: true,
        },
    };
}
