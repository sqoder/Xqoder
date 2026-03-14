import stringWidth from 'string-width';
import type { ScreenBuffer } from './screen-buffer.js';
import type { CellStyle } from './screen-buffer.js';
import { buildScrollbarModel, getViewportVisibleLines, normalizeViewportSelection, displayColumnToIndex } from './viewport-model.js';
import { getEditorViewModel, sliceLineByDisplayWidth } from './editor-model.js';
import type { TerminalAppState, OverlaySessionItem, OverlayModelItem, OverlayCommandItem, OverlayFilepickerItem, OverlayThemeItem, OverlayCompleteItem } from './app-state.js';
import type { TranscriptCodeBlock } from './transcript-blocks.js';
import { APPROVAL_MENU_LINES } from './interaction-protocol.js';

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

/** 把一行按占位符 display 拆成片段，用于画黄色标记 */
function segmentLineByPlaceholders(
    line: string,
    displays: string[],
): Array<{ text: string; isPlaceholder: boolean }> {
    if (displays.length === 0) return [{ text: line, isPlaceholder: false }];
    const matches: Array<{ start: number; end: number }> = [];
    for (const d of displays) {
        let idx = 0;
        while (true) {
            const i = line.indexOf(d, idx);
            if (i === -1) break;
            matches.push({ start: i, end: i + d.length });
            idx = i + 1;
        }
    }
    matches.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const m of matches) {
        if (merged.length > 0 && m.start <= merged[merged.length - 1]!.end) {
            merged[merged.length - 1]!.end = Math.max(merged[merged.length - 1]!.end, m.end);
        } else {
            merged.push({ ...m });
        }
    }
    const out: Array<{ text: string; isPlaceholder: boolean }> = [];
    let pos = 0;
    for (const m of merged) {
        if (m.start > pos) {
            out.push({ text: line.slice(pos, m.start), isPlaceholder: false });
        }
        out.push({ text: line.slice(m.start, m.end), isPlaceholder: true });
        pos = m.end;
    }
    if (pos < line.length) {
        out.push({ text: line.slice(pos), isPlaceholder: false });
    }
    return out;
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
    /** 粘贴提示 [Pasted N lines]，OpenCode 风格橙底 */
    pasteHint: CellStyle;
    /** Toast 浮层：success / error / info */
    toastSuccess: CellStyle;
    toastError: CellStyle;
    toastInfo: CellStyle;
    /** 选中文本高亮（阴影） */
    selection: CellStyle;
}

/** 与终端主题一致：不输出任何自定义颜色，全部使用终端默认前景/背景 */
const EMPTY_STYLE: CellStyle = {};
/** 橙色高亮：粘贴提示与复制按钮（OpenCode 风格） */
const ORANGE_ACCENT: CellStyle = { bg: '#c45a11', fg: '#1a1a1a' };
export const DEFAULT_TERMINAL_THEME: TerminalTheme = {
    background: EMPTY_STYLE,
    border: EMPTY_STYLE,
    shadow: EMPTY_STYLE,
    title: EMPTY_STYLE,
    transcript: EMPTY_STYLE,
    codeBlock: EMPTY_STYLE,
    copyButton: ORANGE_ACCENT,
    editor: EMPTY_STYLE,
    status: EMPTY_STYLE,
    sidebarTitle: EMPTY_STYLE,
    sidebarBody: EMPTY_STYLE,
    scrollbarTrack: EMPTY_STYLE,
    scrollbarThumb: EMPTY_STYLE,
    scrollbarTerminalTrack: EMPTY_STYLE,
    pasteHint: ORANGE_ACCENT,
    toastSuccess: ORANGE_ACCENT,
    toastError: EMPTY_STYLE,
    toastInfo: EMPTY_STYLE,
    /** 拖选时选区反色高亮，便于看到已选范围 */
    selection: { inverse: true },
};

/** 深色主题（深灰底、浅字） */
const DARK_TERMINAL_THEME: TerminalTheme = {
    ...DEFAULT_TERMINAL_THEME,
    background: { bg: '#1a1a1a' },
    border: { fg: '#444' },
    shadow: { bg: '#111' },
    title: { fg: '#eee' },
    transcript: { fg: '#ccc' },
    codeBlock: { bg: '#2a2a2a', fg: '#ddd' },
    editor: { bg: '#252525', fg: '#e0e0e0' },
    status: { fg: '#888' },
    sidebarTitle: { fg: '#aaa' },
    sidebarBody: { fg: '#888' },
};

/** One Dark 风格（深蓝灰） */
const ONEDARK_TERMINAL_THEME: TerminalTheme = {
    ...DEFAULT_TERMINAL_THEME,
    background: { bg: '#282c34' },
    border: { fg: '#5c6370' },
    shadow: { bg: '#21252b' },
    title: { fg: '#61afef' },
    transcript: { fg: '#abb2bf' },
    codeBlock: { bg: '#2c323c', fg: '#abb2bf' },
    editor: { bg: '#2c323c', fg: '#abb2bf' },
    status: { fg: '#5c6370' },
    sidebarTitle: { fg: '#e5c07b' },
    sidebarBody: { fg: '#5c6370' },
};

/** Gruvbox dark 风格（暖棕） */
const GRUVBOX_TERMINAL_THEME: TerminalTheme = {
    ...DEFAULT_TERMINAL_THEME,
    background: { bg: '#282828' },
    border: { fg: '#665c54' },
    shadow: { bg: '#1d2021' },
    title: { fg: '#fabd2f' },
    transcript: { fg: '#ebdbb2' },
    codeBlock: { bg: '#3c3836', fg: '#ebdbb2' },
    editor: { bg: '#3c3836', fg: '#ebdbb2' },
    status: { fg: '#928374' },
    sidebarTitle: { fg: '#83a598' },
    sidebarBody: { fg: '#928374' },
};

/** 浅色主题 */
const LIGHT_TERMINAL_THEME: TerminalTheme = {
    ...DEFAULT_TERMINAL_THEME,
    background: { bg: '#f5f5f5' },
    border: { fg: '#999' },
    shadow: { bg: '#e0e0e0' },
    title: { fg: '#333' },
    transcript: { fg: '#333' },
    codeBlock: { bg: '#fff', fg: '#333' },
    copyButton: { bg: '#c45a11', fg: '#fff' },
    editor: { bg: '#fff', fg: '#333' },
    status: { fg: '#666' },
    sidebarTitle: { fg: '#555' },
    sidebarBody: { fg: '#666' },
};

export const TERMINAL_THEME_IDS = ['default', 'dark', 'onedark', 'gruvbox', 'light'] as const;
export type TerminalThemeId = (typeof TERMINAL_THEME_IDS)[number];

export const TERMINAL_THEME_LABELS: Record<TerminalThemeId, string> = {
    default: 'Default',
    dark: 'Dark',
    onedark: 'One Dark',
    gruvbox: 'Gruvbox',
    light: 'Light',
};

const THEME_MAP: Record<TerminalThemeId, TerminalTheme> = {
    default: DEFAULT_TERMINAL_THEME,
    dark: DARK_TERMINAL_THEME,
    onedark: ONEDARK_TERMINAL_THEME,
    gruvbox: GRUVBOX_TERMINAL_THEME,
    light: LIGHT_TERMINAL_THEME,
};

export function getTheme(id: string): TerminalTheme {
    return THEME_MAP[id as TerminalThemeId] ?? DEFAULT_TERMINAL_THEME;
}

export interface LayoutMetrics {
    mainWidth: number;
    sidebarWidth: number;
    transcriptHeight: number;
    transcriptContentWidth: number;
    editorContentWidth?: number;
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

    const isLogs = state.page === 'logs';
    const titleText = isLogs ? 'Logs' : state.title;
    buffer.writeText(left, titleRow, titleText, theme.title);
    if (layout.innerWidth != null) {
        buffer.fillRect(left, sep1, layout.innerWidth, 1, theme.shadow);
    }
    if (sidebarWidth > 0 && layout.mainWidth !== state.size.width) {
        buffer.drawVerticalLine(layout.mainWidth + left, 0, state.size.height - layout.statusHeight, '│', theme.border);
    }

    const visibleLines = isLogs
        ? getViewportVisibleLines(state.logLines, state.logViewport, transcriptHeight)
        : getViewportVisibleLines(state.transcriptLines, state.viewport, transcriptHeight);
    const contentWidthForCopy = Math.max(0, scrollbarCol - left - COPY_BUTTON_WIDTH);
    const sel = !isLogs && state.viewport.selection ? normalizeViewportSelection(state.viewport.selection.start, state.viewport.selection.end) : null;
    const viewportTopLine = isLogs ? state.logViewport.topLine : state.viewport.topLine;

    visibleLines.forEach((line, index) => {
        const globalLineIndex = viewportTopLine + index;
        const block = isLogs ? null : findBlockContainingLine(state.transcriptCodeBlocks, globalLineIndex);
        const isCodeLine = block != null;
        const showCopyButton = !isLogs && block != null && isFirstLineOfBlock(block, globalLineIndex);
        const lineStyle = isCodeLine ? theme.codeBlock : theme.transcript;
        const lineToDraw = showCopyButton ? truncateToWidth(line, contentWidthForCopy) : line;
        const row = startRow + index;

        if (sel && globalLineIndex >= sel.start.line && globalLineIndex <= sel.end.line) {
            const lineLen = lineToDraw.length;
            const startCol = globalLineIndex === sel.start.line ? sel.start.column : 0;
            const endCol = globalLineIndex === sel.end.line ? sel.end.column : 9999;
            const startIdx = Math.min(lineLen, displayColumnToIndex(lineToDraw, startCol));
            const endIdx = Math.min(lineLen, Math.max(startIdx, displayColumnToIndex(lineToDraw, endCol)));
            let x = left;
            if (startIdx > 0) {
                const before = lineToDraw.slice(0, startIdx);
                buffer.writeText(x, row, before, lineStyle);
                x += stringWidth(before);
            }
            if (endIdx > startIdx) {
                const seg = lineToDraw.slice(startIdx, endIdx);
                buffer.writeText(x, row, seg, theme.selection);
                x += stringWidth(seg);
            }
            if (endIdx < lineLen) {
                buffer.writeText(x, row, lineToDraw.slice(endIdx), lineStyle);
            }
        } else {
            buffer.writeText(left, row, lineToDraw, lineStyle);
        }

        if (showCopyButton) {
            const copyLabel = state.copiedBlockId === block!.id ? 'Copied ✓' : '[ Copy ]';
            const copyX = Math.max(left, scrollbarCol - COPY_BUTTON_WIDTH);
            buffer.writeText(copyX, row, copyLabel, theme.copyButton);
        }
    });

    const lineCount = isLogs ? state.logLines.length : state.transcriptLines.length;
    const scrollbarTop = isLogs ? state.logViewport.topLine : state.viewport.topLine;
    const scrollbar = buildScrollbarModel(lineCount, transcriptHeight, scrollbarTop);
    const scrollbarWidth = 2;
    buffer.fillRect(scrollbarCol, startRow, scrollbarWidth, scrollbar.trackHeight, theme.scrollbarTrack);
    if (scrollbar.visible && scrollbar.thumbHeight > 0) {
        for (let row = 0; row < scrollbar.thumbHeight; row += 1) {
            buffer.writeText(scrollbarCol, startRow + scrollbar.thumbTop + row, '██', theme.scrollbarThumb);
        }
    }
    if (layout.separatorRow2 != null && layout.innerWidth != null) {
        buffer.fillRect(left, layout.separatorRow2, layout.innerWidth, 1, theme.shadow);
    }

    // 当等待工具审批时，在 transcript 区最底部显示三行菜单（紧邻编辑框上方）
    if (state.pendingApproval) {
        const baseY = startRow + transcriptHeight - 3;
        const selected = state.pendingApproval.selectedIndex ?? 0;
        APPROVAL_MENU_LINES.forEach((text, index) => {
            const style: CellStyle = index === selected ? theme.pasteHint : theme.status;
            const prefix = index === selected ? '▶ ' : '  ';
            buffer.writeText(left, baseY + index, prefix + text, style);
        });
        return;
    }

    if (state.pendingQuestion) {
        const q = state.pendingQuestion;
        const maxLines = Math.max(3, Math.min(transcriptHeight - 1, 8));
        const questionTitle = q.header ? `${q.header}: ${q.question}` : q.question;
        const optionLines = q.options.slice(0, Math.max(1, maxLines - 2)).map((option, index) => {
            const focused = index === q.selectedIndex;
            const checked = q.selected.includes(option.label);
            const marker = q.multiple ? (checked ? '[x]' : '[ ]') : (checked ? '(*)' : '( )');
            return {
                text: `${marker} ${option.label}`,
                focused,
            };
        });

        const startY = startRow + transcriptHeight - (optionLines.length + 2);
        buffer.writeText(left, startY, questionTitle.slice(0, Math.max(10, mainWidth - 2)), theme.status);
        optionLines.forEach((line, index) => {
            const style: CellStyle = line.focused ? theme.pasteHint : theme.status;
            const prefix = line.focused ? '▶ ' : '  ';
            buffer.writeText(left, startY + 1 + index, `${prefix}${line.text}`.slice(0, Math.max(10, mainWidth - 2)), style);
        });
    }
}

/** 底部输入框：仅上下 ─── 横线，无左右边框 */
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
    buffer.drawHorizontalLine(left, editorY, w, '─', s);
    buffer.drawHorizontalLine(left, editorY + editorHeight - 1, w, '─', s);
    let editorRow = editorY + 1;
    const contentX = left + 1;
    if (state.editor.attachments.length > 0) {
        const labels = state.editor.attachments.map((a) => `[${a.label}]`).join(' ');
        buffer.writeText(contentX, editorRow, labels, theme.status);
        editorRow += 1;
    }
    const contentWidth = layout.editorContentWidth ?? Math.max(10, w - 4);
    const editorView = getEditorViewModel(state.editor, contentWidth);
    const editorLines = editorView.visibleLines.length > 0 ? editorView.visibleLines : [state.editor.placeholder];
    const cursorLineIndex = editorView.wrapped && editorView.cursorWrappedLine != null
        ? editorView.cursorWrappedLine - editorView.visibleStartRow
        : editorView.cursor.line - editorView.visibleStartRow;
    const scrollCol = editorView.wrapped ? 0 : Math.max(0, editorView.cursor.column - contentWidth + 1);

    const pasteHint = state.pasteHint;
    const badgeText = pasteHint
        ? `[Pasted ${pasteHint.lineCount} line${pasteHint.lineCount === 1 ? '' : 's'}]`
        : '';
    const badgeWidth = badgeText ? stringWidth(badgeText) + 2 : 0;
    const firstLineX = contentX + badgeWidth;
    const placeholderDisplays = state.editor.pastePlaceholders.map((p) => p.display);

    editorLines.forEach((line, index) => {
        const isCursorLine = index === cursorLineIndex;
        const startCol = isCursorLine ? scrollCol : 0;
        const lineContentWidth = contentWidth - (index === 0 ? badgeWidth : 0);
        const visible = editorView.wrapped ? line : sliceLineByDisplayWidth(line, startCol, lineContentWidth);
        const prefix = index === 0 ? '> ' : '  ';
        const row = editorRow + index;
        const baseX = (index === 0 && badgeText ? firstLineX : contentX);

        if (index === 0 && badgeText) {
            buffer.writeText(contentX, row, badgeText, theme.pasteHint);
        }
        buffer.writeText(baseX, row, prefix, theme.editor);
        let segX = baseX + 2;
        const segments = segmentLineByPlaceholders(visible, placeholderDisplays);
        for (const seg of segments) {
            if (seg.text.length === 0) continue;
            buffer.writeText(segX, row, seg.text, seg.isPlaceholder ? theme.pasteHint : theme.editor);
            segX += stringWidth(seg.text);
        }
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

/** 模块 4：Toast 浮层，固定右上角，不占布局，只显示最新一条 */
export function renderToastLayer(
    buffer: ScreenBuffer,
    state: TerminalAppState,
    theme: TerminalTheme,
): void {
    const toasts = state.toasts;
    if (toasts.length === 0) return;
    const toast = toasts[toasts.length - 1]!;
    const row = 1;
    const padding = 2;
    const w = stringWidth(toast.text);
    const x = Math.max(0, state.size.width - w - padding);
    const style =
        toast.kind === 'error'
            ? theme.toastError
            : toast.kind === 'info'
              ? theme.toastInfo
              : theme.toastSuccess;
    const boxX = Math.max(0, x - 1);
    const boxW = Math.min(state.size.width - boxX, w + padding + 2);
    if (boxW > 0) buffer.fillRect(boxX, row, boxW, 1, style);
    buffer.writeText(x, row, toast.text, style);
}

/** OpenCode 风格 overlay：居中弹窗，Session 或 Model 列表，↑↓ Enter Esc */
export function renderOverlayLayer(
    buffer: ScreenBuffer,
    state: TerminalAppState,
    theme: TerminalTheme,
): void {
    const ov = state.overlay;
    if (!ov) return;
    const w = buffer.width;
    const h = buffer.height;
    const boxContentWidth = 48;
    const maxListRows = 12;
    const isFilepickerOrComplete = ov.type === 'filepicker' || ov.type === 'complete';
    const isArguments = ov.type === 'arguments';
    const isTheme = ov.type === 'theme';
    const isInit = ov.type === 'init';
    const listLength = isArguments ? ov.variables.length : ov.items.length;
    const listRows = Math.min(maxListRows, listLength);
    const boxH = isArguments ? 3 + listRows + 1 + 1 : isFilepickerOrComplete ? 3 + listRows + 1 : 2 + listRows + 1;
    const boxW = Math.min(w - 4, boxContentWidth + 4);
    const boxX = Math.max(0, Math.floor((w - boxW) / 2));
    const boxY = Math.max(0, Math.floor((h - boxH) / 2));

    const borderStyle = theme.border;
    const titleStyle = theme.title;
    const bodyStyle = theme.transcript;
    const selectedStyle = theme.pasteHint;

    buffer.fillRect(boxX, boxY, boxW, boxH, theme.shadow.bg ? theme.shadow : theme.background);
    buffer.drawBox(boxX, boxY, boxW, boxH, borderStyle);
    const title =
        ov.type === 'session'
            ? ' Session'
            : ov.type === 'model'
              ? ` Model (${ov.providers[ov.providerIndex] ?? ''})`
              : ov.type === 'commands'
                ? ' Commands'
                : ov.type === 'complete'
                  ? ' Complete (@)'
                  : ov.type === 'arguments'
                    ? ' Arguments ($VAR)'
                    : ov.type === 'theme'
                      ? ' Theme'
                      : ov.type === 'init'
                        ? ' Initialize'
                        : ' File Picker';
    buffer.writeText(boxX + 1, boxY, truncateToWidth(title, boxW - 2), titleStyle);

    const pathRowY = boxY + 1;
    let listStartY = isFilepickerOrComplete ? boxY + 2 : boxY + 1;
    if (isArguments && ov.type === 'arguments') {
        buffer.writeText(boxX + 1, pathRowY, truncateToWidth(ov.commandName, boxW - 2), theme.status);
        listStartY = boxY + 2;
    } else if (ov.type === 'model') {
        listStartY = boxY + 1;
    } else if (isFilepickerOrComplete && (ov.type === 'filepicker' || ov.type === 'complete')) {
        buffer.writeText(boxX + 1, pathRowY, truncateToWidth(ov.currentDir, boxW - 2), theme.status);
    }
    const itemWidth = boxW - 4;
    const totalItems = isArguments && ov.type === 'arguments' ? ov.variables.length : ov.items.length;
    const visibleStart = totalItems <= listRows ? 0 : Math.max(0, Math.min(ov.selectedIndex - listRows + 1, totalItems - listRows));
    const visibleEnd = Math.min(visibleStart + listRows, totalItems);
    for (let i = 0; i < visibleEnd - visibleStart; i += 1) {
        const idx = visibleStart + i;
        const rowY = listStartY + i;
        const isSelected = idx === ov.selectedIndex;
        const style = isSelected ? selectedStyle : bodyStyle;
        let label: string;
        if (isArguments && ov.type === 'arguments') {
            const v = ov.variables[idx]!;
            const val = idx === ov.selectedIndex ? ov.editBuffer : (ov.values[v] ?? '');
            label = `${v} = ${val}`;
        } else if (isInit && ov.type === 'init') {
            const rawInit = ov.items[idx];
            label = rawInit ? rawInit.label : '';
        } else {
            const raw = ov.items[idx];
            if (!raw) break;
            if (ov.type === 'complete') {
                const it = raw as OverlayCompleteItem;
                const indent = '  '.repeat(it.depth);
                const expand = it.isDir ? (ov.expandedDirs.includes(it.path) ? '[-] ' : '[+] ') : '    ';
                label = indent + expand + it.label;
            } else {
                label =
                    ov.type === 'session'
                        ? (raw as OverlaySessionItem).title
                        : ov.type === 'theme'
                          ? (raw as OverlayThemeItem).label
                          : ov.type === 'filepicker'
                            ? ((raw as OverlayFilepickerItem).isDir ? '[dir] ' : '') + (raw as OverlayFilepickerItem).label
                            : (raw as OverlayModelItem | OverlayCommandItem).label;
            }
        }
        const text = truncateToWidth(label, itemWidth);
        buffer.fillRect(boxX + 2, rowY, itemWidth, 1, style);
        buffer.writeText(boxX + 2, rowY, text, style);
    }
    let footerY = listStartY + listRows;
    if (isArguments && ov.type === 'arguments') {
        buffer.writeText(boxX + 1, footerY, truncateToWidth(`> ${ov.editBuffer}_`, itemWidth), theme.editor);
        footerY += 1;
    }
    const footerText = isArguments
        ? ' Type value  Enter next  Esc cancel'
        : isFilepickerOrComplete
          ? ' ↑↓ j/k l  Enter  Esc'
          : isInit
            ? ' ↑↓ j/k  Enter  Esc = Skip'
            : ov.type === 'model'
              ? ' ←→ h/l provider  ↑↓ j/k  Enter  Esc'
              : ' ↑↓ select  Enter  Esc close';
    buffer.writeText(boxX + 1, footerY, truncateToWidth(footerText, boxW - 2), theme.status);
}
