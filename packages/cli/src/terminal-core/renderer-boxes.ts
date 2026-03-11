import stringWidth from 'string-width';
import type { ScreenBuffer } from './screen-buffer.js';
import type { CellStyle } from './screen-buffer.js';
import { buildScrollbarModel, getViewportVisibleLines } from './viewport-model.js';
import { getEditorViewModel } from './editor-model.js';
import type { TerminalAppState } from './app-state.js';
import type { TranscriptCodeBlock } from './transcript-blocks.js';

const COPY_BUTTON_WIDTH = 12;

function truncateToWidth(s: string, maxWidth: number): string {
    let w = 0;
    for (let i = 0; i < s.length; i += 1) {
        w += Math.max(1, stringWidth(s[i]!));
        if (w > maxWidth) return s.slice(0, i);
    }
    return s;
}

function findBlockContainingLine(blocks: TranscriptCodeBlock[], lineIndex: number): TranscriptCodeBlock | undefined {
    return blocks.find((b) => lineIndex >= b.startLine && lineIndex <= b.endLine);
}

function isFirstLineOfBlock(block: TranscriptCodeBlock, lineIndex: number): boolean {
    return block.startLine === lineIndex;
}

export interface TerminalTheme {
    background: CellStyle;
    border: CellStyle;
    /** 阴影/凹槽：仅用颜色深浅区分区域，不画线。更深 = 凹进去，更浅 = 凸出来。 */
    shadow: CellStyle;
    title: CellStyle;
    transcript: CellStyle;
    codeBlock: CellStyle;
    copyButton: CellStyle;
    editor: CellStyle;
    status: CellStyle;
    sidebarTitle: CellStyle;
    sidebarBody: CellStyle;
    scrollbarTrack: CellStyle;
    scrollbarThumb: CellStyle;
    scrollbarTerminalTrack?: CellStyle;
}

export const DEFAULT_TERMINAL_THEME: TerminalTheme = {
    background: { fg: '#d7dde6', bg: '#0b1220' },
    border: { fg: '#58708a', bg: '#0b1220' },
    shadow: { bg: '#070d14' },
    title: { fg: '#f7d37d', bg: '#0b1220', bold: true },
    transcript: { fg: '#d7dde6', bg: '#0b1220' },
    codeBlock: { fg: '#b9c6d8', bg: '#151d2e' },
    copyButton: { fg: '#86b7ff', bg: '#0b1220' },
    editor: { fg: '#f5f7fb', bg: '#101827' },
    status: { fg: '#9fb3c8', bg: '#0b1220' },
    sidebarTitle: { fg: '#86b7ff', bg: '#0b1220', bold: true },
    sidebarBody: { fg: '#b9c6d8', bg: '#0b1220' },
    scrollbarTrack: { fg: '#2b3542', bg: '#0b1220' },
    scrollbarThumb: { fg: '#9fb3c8', bg: '#0b1220' },
    scrollbarTerminalTrack: { fg: '#1e2936', bg: '#0b1220', dim: true },
};

export interface LayoutMetrics {
    mainWidth: number;
    sidebarWidth: number;
    transcriptHeight: number;
    transcriptContentWidth: number;
    scrollbarCol: number;
    editorY: number;
    editorHeight: number;
    statusY: number;
    statusHeight: number;
    sidebarX: number;
    outerScrollbarCol: number;
    /** 整屏大 Box 时的内边距与行号 */
    innerLeft?: number;
    innerTop?: number;
    innerWidth?: number;
    innerHeight?: number;
    titleRow?: number;
    separatorRow1?: number;
    transcriptStartRow?: number;
    separatorRow2?: number;
    statusRow?: number;
}

/** 整屏大 Box：用阴影色块做边框（不画线），内容区视觉上凸起。 */
export function renderOuterFrameBox(
    buffer: ScreenBuffer,
    state: TerminalAppState,
    layout: LayoutMetrics,
    theme: TerminalTheme,
): void {
    const w = state.size.width;
    const h = state.size.height;
    if (w < 2 || h < 2) return;
    const s = theme.shadow;
    buffer.fillRect(0, 0, w, 1, s);
    buffer.fillRect(0, h - 1, w, 1, s);
    buffer.fillRect(0, 1, 1, h - 2, s);
    buffer.fillRect(w - 1, 1, 1, h - 2, s);
}

/** 对话框 + 内层滚动条（对话区 Box），在大框内从 titleRow/transcriptStartRow 画起 */
export function renderTranscriptBox(
    buffer: ScreenBuffer,
    state: TerminalAppState,
    layout: LayoutMetrics,
    theme: TerminalTheme,
): void {
    const left = layout.innerLeft ?? 0;
    const titleRow = layout.titleRow ?? 0;
    const sep1 = layout.separatorRow1 ?? 1;
    const startRow = layout.transcriptStartRow ?? 1;
    const { transcriptHeight, scrollbarCol, mainWidth, sidebarWidth } = layout;

    buffer.writeText(left, titleRow, state.title, theme.title);
    if (layout.innerWidth != null) {
        buffer.fillRect(left, sep1, layout.innerWidth, 1, theme.shadow);
    }
    if (sidebarWidth > 0 && layout.mainWidth !== state.size.width) {
        buffer.drawVerticalLine(layout.mainWidth + left, 0, state.size.height - layout.statusHeight, '│', theme.border);
    }

    const visibleLines = getViewportVisibleLines(state.transcriptLines, state.viewport, transcriptHeight);
    const contentWidthForCopy = Math.max(0, scrollbarCol - left - COPY_BUTTON_WIDTH);
    visibleLines.forEach((line, index) => {
        const globalLineIndex = state.viewport.topLine + index;
        const block = findBlockContainingLine(state.transcriptCodeBlocks, globalLineIndex);
        const isCodeLine = block != null;
        const showCopyButton = block != null && isFirstLineOfBlock(block, globalLineIndex);
        const lineStyle = isCodeLine ? theme.codeBlock : theme.transcript;
        const lineToDraw = showCopyButton ? truncateToWidth(line, contentWidthForCopy) : line;
        buffer.writeText(left, startRow + index, lineToDraw, lineStyle);
        if (showCopyButton) {
            const copyLabel = state.copiedBlockId === block!.id ? 'Copied ✓' : '[ Copy ]';
            const copyX = Math.max(left, scrollbarCol - COPY_BUTTON_WIDTH);
            buffer.writeText(copyX, startRow + index, copyLabel, theme.copyButton);
        }
    });

    const scrollbar = buildScrollbarModel(state.transcriptLines.length, transcriptHeight, state.viewport.topLine);
    for (let row = 0; row < scrollbar.trackHeight; row += 1) {
        const inThumb = scrollbar.visible && row >= scrollbar.thumbTop && row < scrollbar.thumbTop + scrollbar.thumbHeight;
        buffer.writeText(scrollbarCol, startRow + row, inThumb ? '█' : '│', inThumb ? theme.scrollbarThumb : theme.scrollbarTrack);
    }
    if (layout.separatorRow2 != null && layout.innerWidth != null) {
        buffer.fillRect(left, layout.separatorRow2, layout.innerWidth, 1, theme.shadow);
    }
}

/** 底部输入框 Box，用阴影色块做边框（不画线） */
export function renderEditorBox(
    buffer: ScreenBuffer,
    state: TerminalAppState,
    layout: LayoutMetrics,
    theme: TerminalTheme,
): void {
    const left = layout.innerLeft ?? 0;
    const w = layout.innerWidth ?? layout.mainWidth;
    const { editorY, editorHeight } = layout;
    const s = theme.shadow;
    buffer.fillRect(left, editorY, w, 1, s);
    buffer.fillRect(left, editorY + editorHeight - 1, w, 1, s);
    buffer.fillRect(left, editorY + 1, 1, editorHeight - 2, s);
    buffer.fillRect(left + w - 1, editorY + 1, 1, editorHeight - 2, s);
    let editorRow = editorY + 1;
    const contentX = left + 1;
    if (state.editor.attachments.length > 0) {
        const labels = state.editor.attachments.map((a) => `[${a.label}]`).join(' ');
        buffer.writeText(contentX, editorRow, labels, theme.status);
        editorRow += 1;
    }
    const editorView = getEditorViewModel(state.editor);
    const editorLines = editorView.visibleLines.length > 0 ? editorView.visibleLines : [state.editor.placeholder];
    editorLines.forEach((line, index) => {
        buffer.writeText(contentX, editorRow + index, index === 0 ? `> ${line}` : `  ${line}`, theme.editor);
    });
}

/** 右侧记录栏 Box */
export function renderSidebarBox(
    buffer: ScreenBuffer,
    state: TerminalAppState,
    layout: LayoutMetrics,
    theme: TerminalTheme,
): void {
    const { sidebarX } = layout;
    buffer.writeText(sidebarX + 1, 0, 'Sidebar', theme.sidebarTitle);
    let sidebarY = 2;
    for (const section of state.sidebar) {
        buffer.writeText(sidebarX + 1, sidebarY, section.title, theme.sidebarTitle);
        sidebarY += 1;
        for (const line of section.lines) {
            buffer.writeText(sidebarX + 1, sidebarY, line, theme.sidebarBody);
            sidebarY += 1;
        }
        sidebarY += 1;
    }
}

/** 底部状态栏 Box，在大框内从 statusRow 画起 */
export function renderStatusBox(
    buffer: ScreenBuffer,
    state: TerminalAppState,
    layout: LayoutMetrics,
    theme: TerminalTheme,
): void {
    const left = layout.innerLeft ?? 0;
    const statusY = layout.statusRow ?? layout.statusY;
    const w = layout.innerWidth ?? state.size.width;
    if (layout.statusRow != null) {
        buffer.fillRect(left, statusY - 1, w, 1, theme.shadow);
    }
    buffer.writeText(left, statusY, state.statusItems.map((item) => item.text).join('   '), theme.status);
}

/** 最右侧终端导航条（视觉边界）Box，仅在有 sidebar 时绘制 */
export function renderOuterScrollbarBox(
    buffer: ScreenBuffer,
    state: TerminalAppState,
    layout: LayoutMetrics,
    theme: TerminalTheme,
): void {
    if (layout.outerScrollbarCol < 0) return;
    const style = theme.scrollbarTerminalTrack ?? theme.scrollbarTrack;
    buffer.drawVerticalLine(layout.outerScrollbarCol, 0, state.size.height - layout.statusHeight, '│', style);
}
