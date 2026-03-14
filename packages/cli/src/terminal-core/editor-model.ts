import stringWidth from 'string-width';

export interface EditorAttachment {
    id: string;
    label: string;
    kind: 'file' | 'image' | 'text';
    path?: string;
}

/** 多行粘贴时在输入框中显示的占位符，提交时展开为 raw */
export interface PastePlaceholder {
    id: string;
    display: string;
    raw: string;
}

export interface EditorModel {
    value: string;
    cursorOffset: number;
    scrollRow: number;
    maxVisibleRows: number;
    attachments: EditorAttachment[];
    placeholder: string;
    /** 粘贴占位符：value 中含 display，提交时替换为 raw（OpenCode 行为） */
    pastePlaceholders: PastePlaceholder[];
    /** 输入区显示宽度，用于自动换行；由 resize 时设置 */
    contentWidth?: number;
    /** 折行时的滚动行号（折行空间） */
    scrollRowWrapped?: number;
}

const MIN_VISIBLE_ROWS = 4;
const MAX_VISIBLE_ROWS = 24;

export type EditorAction =
    | { type: 'insert-text'; text: string }
    | { type: 'paste'; text: string }
    | { type: 'paste-as-placeholder'; text: string }
    | { type: 'delete-backward' }
    | { type: 'delete-forward' }
    | { type: 'delete-to-line-start' }
    | { type: 'move-horizontal'; delta: number }
    | { type: 'move-vertical'; delta: number }
    | { type: 'move-boundary'; edge: 'start' | 'end' }
    | { type: 'set-visible-rows'; rows: number }
    | { type: 'set-value'; value: string; cursorOffset?: number }
    | { type: 'append-attachment'; attachment: EditorAttachment }
    | { type: 'remove-attachment'; id: string }
    | { type: 'clear-attachments' }
    | { type: 'apply-external-editor'; value: string }
    | { type: 'set-content-width'; width: number };

export interface EditorCursorPosition {
    line: number;
    column: number;
}

export interface EditorViewModel {
    lines: string[];
    cursor: EditorCursorPosition;
    visibleLines: string[];
    visibleStartRow: number;
    /** 折行时：光标所在的折行行号、该行内显示列（用于绘制） */
    cursorWrappedLine?: number;
    cursorWrappedCol?: number;
    /** 是否按 contentWidth 折行显示 */
    wrapped: boolean;
}

function shortId(): string {
    return Math.random().toString(36).slice(2, 10);
}

export function createEditorModel(options: Partial<Pick<EditorModel, 'value' | 'placeholder' | 'maxVisibleRows'>> = {}): EditorModel {
    const value = options.value ?? '';
    return {
        value,
        cursorOffset: value.length,
        scrollRow: 0,
        maxVisibleRows: options.maxVisibleRows ?? MIN_VISIBLE_ROWS,
        attachments: [],
        placeholder: options.placeholder ?? 'Type a message...',
        pastePlaceholders: [],
    };
}

/** 提交时把 value 中的占位符 display 替换为 raw，得到真实发送内容 */
export function expandEditorValueForSubmit(model: EditorModel): string {
    let s = model.value;
    for (const p of model.pastePlaceholders) {
        if (s.includes(p.display)) {
            s = s.replace(p.display, p.raw);
        }
    }
    return s;
}

function clampOffset(value: string, offset: number): number {
    return Math.max(0, Math.min(value.length, offset));
}

export function offsetToEditorCursor(value: string, offset: number): EditorCursorPosition {
    const safeOffset = clampOffset(value, offset);
    const lines = value.slice(0, safeOffset).split('\n');
    const line = lines.length - 1;
    const column = stringWidth(lines[line] ?? '');
    return { line, column };
}

/** 按显示宽度将一行折成多行（soft wrap），每段不超过 maxWidth。 */
export function wrapLineByDisplayWidth(line: string, maxWidth: number): string[] {
    if (maxWidth <= 0) return [line];
    const out: string[] = [];
    let start = 0;
    while (start < line.length) {
        let col = 0;
        let end = start;
        for (let i = start; i < line.length; i += 1) {
            const w = Math.max(1, stringWidth(line[i]!));
            if (col + w > maxWidth && end > start) break;
            col += w;
            end = i + 1;
        }
        out.push(line.slice(start, end));
        start = end;
    }
    return out.length === 0 ? [''] : out;
}

/** 按显示宽度截取一行：跳过前 startCol 列，取最多 maxWidth 列。用于输入框水平视口，避免光标跑到屏幕外。 */
export function sliceLineByDisplayWidth(line: string, startCol: number, maxWidth: number): string {
    if (maxWidth <= 0) return '';
    let col = 0;
    let startIndex = line.length;
    for (let i = 0; i < line.length; i += 1) {
        const w = Math.max(1, stringWidth(line[i]!));
        if (col + w > startCol) {
            startIndex = i;
            break;
        }
        col += w;
    }
    if (startIndex >= line.length) return '';
    col = 0;
    let endIndex = startIndex;
    for (let i = startIndex; i < line.length; i += 1) {
        const w = Math.max(1, stringWidth(line[i]!));
        if (col + w > maxWidth) break;
        col += w;
        endIndex = i + 1;
    }
    return line.slice(startIndex, endIndex);
}

/** 给定一行和显示列数，返回对应的字符下标（用于点击定位光标）。 */
export function characterIndexAtDisplayColumn(line: string, displayCol: number): number {
    if (displayCol <= 0) return 0;
    let col = 0;
    for (let i = 0; i < line.length; i += 1) {
        const w = Math.max(1, stringWidth(line[i]!));
        if (col + w > displayCol) return i;
        col += w;
    }
    return line.length;
}

function lineColumnToOffset(value: string, line: number, column: number): number {
    const lines = value.split('\n');
    let offset = 0;
    for (let index = 0; index < Math.min(line, lines.length - 1); index += 1) {
        offset += (lines[index]?.length ?? 0) + 1;
    }
    return clampOffset(value, offset + Math.min(column, lines[Math.min(line, lines.length - 1)]?.length ?? 0));
}

function buildWrappedLines(value: string, contentWidth: number): string[] {
    const lines = value.length === 0 ? [''] : value.split('\n');
    const out: string[] = [];
    for (const line of lines) {
        out.push(...wrapLineByDisplayWidth(line, contentWidth));
    }
    return out;
}

function getCursorWrappedPosition(value: string, cursorOffset: number, contentWidth: number): { lineIndex: number; colInLine: number } {
    const lines = value.length === 0 ? [''] : value.split('\n');
    const cursor = offsetToEditorCursor(value, cursorOffset);
    const cursorDisplayCol = stringWidth(lines[cursor.line]?.slice(0, cursor.column) ?? '');
    let globalWrappedLine = 0;
    for (let L = 0; L < cursor.line; L += 1) {
        globalWrappedLine += wrapLineByDisplayWidth(lines[L] ?? '', contentWidth).length;
    }
    const wrappedForLine = wrapLineByDisplayWidth(lines[cursor.line] ?? '', contentWidth);
    let colAcc = 0;
    for (let i = 0; i < wrappedForLine.length; i += 1) {
        const w = stringWidth(wrappedForLine[i]!);
        if (colAcc + w > cursorDisplayCol) {
            return { lineIndex: globalWrappedLine + i, colInLine: cursorDisplayCol - colAcc };
        }
        colAcc += w;
    }
    const last = Math.max(0, wrappedForLine.length - 1);
    return { lineIndex: globalWrappedLine + last, colInLine: stringWidth(wrappedForLine[last] ?? '') };
}

function ensureEditorCursorVisible(model: EditorModel): EditorModel {
    const cursor = offsetToEditorCursor(model.value, model.cursorOffset);
    const cw = model.contentWidth;
    if (cw != null && cw > 0) {
        const wrappedLines = buildWrappedLines(model.value, cw);
        const { lineIndex: cursorWrapped } = getCursorWrappedPosition(model.value, model.cursorOffset, cw);
        const scrollW = model.scrollRowWrapped ?? 0;
        const maxVis = Math.max(1, model.maxVisibleRows);
        if (cursorWrapped < scrollW) {
            return { ...model, scrollRowWrapped: cursorWrapped };
        }
        if (cursorWrapped >= scrollW + maxVis) {
            return { ...model, scrollRowWrapped: cursorWrapped - maxVis + 1 };
        }
        return model;
    }
    if (cursor.line < model.scrollRow) {
        return { ...model, scrollRow: cursor.line };
    }
    const maxVisibleRow = model.scrollRow + Math.max(1, model.maxVisibleRows) - 1;
    if (cursor.line > maxVisibleRow) {
        return { ...model, scrollRow: cursor.line - Math.max(1, model.maxVisibleRows) + 1 };
    }
    return model;
}

function capVisibleRows(lineCount: number): number {
    return Math.min(MAX_VISIBLE_ROWS, Math.max(MIN_VISIBLE_ROWS, lineCount));
}

function effectiveLineCount(value: string, contentWidth?: number): number {
    if (contentWidth != null && contentWidth > 0) return buildWrappedLines(value, contentWidth).length;
    return value.length === 0 ? 1 : value.split('\n').length;
}

function insertText(model: EditorModel, text: string): EditorModel {
    const nextValue = model.value.slice(0, model.cursorOffset) + text + model.value.slice(model.cursorOffset);
    return ensureEditorCursorVisible({
        ...model,
        value: nextValue,
        cursorOffset: model.cursorOffset + text.length,
        maxVisibleRows: capVisibleRows(effectiveLineCount(nextValue, model.contentWidth)),
    });
}

function insertPastePlaceholder(model: EditorModel, text: string): EditorModel {
    const lineCount = Math.max(1, text.split('\n').length);
    const display = `[Pasted ${lineCount} line${lineCount === 1 ? '' : 's'}]`;
    const id = shortId();
    const nextValue = model.value.slice(0, model.cursorOffset) + display + model.value.slice(model.cursorOffset);
    const placeholders = [...model.pastePlaceholders, { id, display, raw: text }];
    return ensureEditorCursorVisible({
        ...model,
        value: nextValue,
        cursorOffset: model.cursorOffset + display.length,
        pastePlaceholders: placeholders,
        maxVisibleRows: capVisibleRows(effectiveLineCount(nextValue, model.contentWidth)),
    });
}

export function reduceEditorModel(model: EditorModel, action: EditorAction): EditorModel {
    switch (action.type) {
        case 'insert-text':
            return insertText(model, action.text);
        case 'paste':
            return insertText(model, action.text);
        case 'paste-as-placeholder':
            return insertPastePlaceholder(model, action.text);
        case 'delete-backward': {
            if (model.cursorOffset === 0) return model;
            const nextValue = model.value.slice(0, model.cursorOffset - 1) + model.value.slice(model.cursorOffset);
            return ensureEditorCursorVisible({
                ...model,
                value: nextValue,
                cursorOffset: model.cursorOffset - 1,
                maxVisibleRows: capVisibleRows(effectiveLineCount(nextValue, model.contentWidth)),
            });
        }
        case 'delete-forward': {
            if (model.cursorOffset >= model.value.length) return model;
            const nextValue = model.value.slice(0, model.cursorOffset) + model.value.slice(model.cursorOffset + 1);
            return ensureEditorCursorVisible({
                ...model,
                value: nextValue,
                maxVisibleRows: capVisibleRows(effectiveLineCount(nextValue, model.contentWidth)),
            });
        }
        case 'delete-to-line-start': {
            const cursor = offsetToEditorCursor(model.value, model.cursorOffset);
            const lines = model.value.split('\n');
            const lineStart = lines.slice(0, cursor.line).join('\n').length;
            if (model.cursorOffset <= lineStart) return model;
            const nextValue = model.value.slice(0, lineStart) + model.value.slice(model.cursorOffset);
            return ensureEditorCursorVisible({ ...model, value: nextValue, cursorOffset: lineStart });
        }
        case 'move-horizontal':
            return ensureEditorCursorVisible({ ...model, cursorOffset: clampOffset(model.value, model.cursorOffset + action.delta) });
        case 'move-vertical': {
            const cursor = offsetToEditorCursor(model.value, model.cursorOffset);
            const nextLine = Math.max(0, cursor.line + action.delta);
            return ensureEditorCursorVisible({ ...model, cursorOffset: lineColumnToOffset(model.value, nextLine, cursor.column) });
        }
        case 'move-boundary': {
            const cursor = offsetToEditorCursor(model.value, model.cursorOffset);
            const lines = model.value.split('\n');
            return ensureEditorCursorVisible({
                ...model,
                cursorOffset: lineColumnToOffset(model.value, cursor.line, action.edge === 'start' ? 0 : stringWidth(lines[cursor.line] ?? '')),
            });
        }
        case 'set-visible-rows':
            return ensureEditorCursorVisible({ ...model, maxVisibleRows: Math.max(1, action.rows) });
        case 'set-value':
            return ensureEditorCursorVisible({
                ...model,
                value: action.value,
                cursorOffset: action.cursorOffset === undefined ? action.value.length : clampOffset(action.value, action.cursorOffset),
                maxVisibleRows: capVisibleRows(effectiveLineCount(action.value, model.contentWidth)),
                pastePlaceholders: action.value.length === 0 ? [] : model.pastePlaceholders,
            });
        case 'append-attachment':
            return { ...model, attachments: [...model.attachments, action.attachment] };
        case 'remove-attachment':
            return { ...model, attachments: model.attachments.filter((attachment) => attachment.id !== action.id) };
        case 'clear-attachments':
            return { ...model, attachments: [] };
        case 'apply-external-editor':
            return ensureEditorCursorVisible({
                ...model,
                value: action.value,
                cursorOffset: action.value.length,
                maxVisibleRows: capVisibleRows(effectiveLineCount(action.value, model.contentWidth)),
            });
        case 'set-content-width':
            return ensureEditorCursorVisible({
                ...model,
                contentWidth: action.width,
                scrollRowWrapped: model.scrollRowWrapped,
            });
        default:
            return model;
    }
}

export function getEditorViewModel(model: EditorModel, contentWidth?: number): EditorViewModel {
    const lines = model.value.length === 0 ? [''] : model.value.split('\n');
    const cursor = offsetToEditorCursor(model.value, model.cursorOffset);
    const cw = model.contentWidth ?? contentWidth ?? 0;
    if (cw > 0) {
        const wrappedLines = buildWrappedLines(model.value, cw);
        const scrollW = model.scrollRowWrapped ?? 0;
        const maxVis = Math.max(1, model.maxVisibleRows);
        const visibleLines = wrappedLines.slice(scrollW, scrollW + maxVis);
        const { lineIndex: cursorWrappedLine, colInLine: cursorWrappedCol } = getCursorWrappedPosition(model.value, model.cursorOffset, cw);
        return {
            lines,
            cursor,
            visibleStartRow: scrollW,
            visibleLines: visibleLines.length > 0 ? visibleLines : [model.placeholder],
            cursorWrappedLine,
            cursorWrappedCol,
            wrapped: true,
        };
    }
    const visibleStartRow = Math.max(0, Math.min(model.scrollRow, Math.max(0, lines.length - model.maxVisibleRows)));
    return {
        lines,
        cursor,
        visibleStartRow,
        visibleLines: lines.slice(visibleStartRow, visibleStartRow + model.maxVisibleRows),
        wrapped: false,
    };
}
