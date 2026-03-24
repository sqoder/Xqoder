import stringWidth from 'string-width';

const graphemeSegmenter: Intl.Segmenter | null =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;

interface GraphemeChunk {
    value: string;
    start: number;
    end: number;
}

function splitGraphemes(text: string): GraphemeChunk[] {
    if (text.length === 0) {
        return [];
    }
    if (graphemeSegmenter) {
        const chunks: GraphemeChunk[] = [];
        const segmented = graphemeSegmenter.segment(text);
        for (const part of segmented) {
            const start = part.index;
            const value = part.segment;
            chunks.push({ value, start, end: start + value.length });
        }
        return chunks;
    }

    const chunks: GraphemeChunk[] = [];
    let offset = 0;
    for (const char of Array.from(text)) {
        chunks.push({ value: char, start: offset, end: offset + char.length });
        offset += char.length;
    }
    return chunks;
}

function previousGraphemeOffset(text: string, offset: number): number {
    const safeOffset = Math.max(0, Math.min(text.length, offset));
    if (safeOffset === 0) {
        return 0;
    }
    const chunks = splitGraphemes(text);
    for (let i = chunks.length - 1; i >= 0; i -= 1) {
        const chunk = chunks[i]!;
        if (chunk.start < safeOffset) {
            return chunk.start;
        }
    }
    return 0;
}

function nextGraphemeOffset(text: string, offset: number): number {
    const safeOffset = Math.max(0, Math.min(text.length, offset));
    if (safeOffset >= text.length) {
        return text.length;
    }
    const chunks = splitGraphemes(text);
    for (const chunk of chunks) {
        if (chunk.end > safeOffset) {
            return chunk.end;
        }
    }
    return text.length;
}

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
    /** 统一输入部件光标：attachments + text(grapheme) */
    cursorPartOffset: number;
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
    /** 连续上下移动时保持的目标显示列（sticky desired column） */
    desiredDisplayColumn?: number;
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
    | { type: 'delete-to-line-end' }
    | { type: 'delete-word-backward' }
    | { type: 'delete-part-forward' }
    | { type: 'move-horizontal'; delta: number }
    | { type: 'move-part-horizontal'; delta: number }
    | { type: 'move-word'; direction: 'backward' | 'forward' }
    | { type: 'move-vertical'; delta: number }
    | { type: 'move-boundary'; edge: 'start' | 'end' }
    | { type: 'move-part-boundary'; edge: 'start' | 'end' }
    | { type: 'set-visible-rows'; rows: number }
    | { type: 'set-value'; value: string; cursorOffset?: number }
    | { type: 'append-attachment'; attachment: EditorAttachment }
    | { type: 'remove-attachment'; id: string }
    | { type: 'clear-attachments' }
    | { type: 'apply-external-editor'; value: string }
    | { type: 'set-content-width'; width: number }
    | { type: 'delete-part-backward' };

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
        cursorPartOffset: countGraphemes(value),
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

export function countGraphemes(text: string): number {
    return splitGraphemes(text).length;
}

export function codeUnitOffsetAtGraphemeIndex(text: string, index: number): number {
    const chunks = splitGraphemes(text);
    if (index <= 0) return 0;
    if (index >= chunks.length) return text.length;
    return chunks[index]!.start;
}

function partOffsetFromCursor(model: EditorModel): number {
    return model.attachments.length + countGraphemes(model.value.slice(0, model.cursorOffset));
}

function applyPartOffset(model: EditorModel, partOffset: number): EditorModel {
    const total = model.attachments.length + countGraphemes(model.value);
    const clamped = Math.max(0, Math.min(total, partOffset));
    if (clamped <= model.attachments.length) {
        return { ...model, cursorPartOffset: clamped, cursorOffset: 0 };
    }
    const textGraphemeIndex = clamped - model.attachments.length;
    return {
        ...model,
        cursorPartOffset: clamped,
        cursorOffset: codeUnitOffsetAtGraphemeIndex(model.value, textGraphemeIndex),
    };
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
    const graphemes = splitGraphemes(line);
    if (graphemes.length === 0) {
        return [''];
    }
    const out: string[] = [];
    let startChunk = 0;
    while (startChunk < graphemes.length) {
        let col = 0;
        let endChunk = startChunk;
        for (let i = startChunk; i < graphemes.length; i += 1) {
            const w = Math.max(1, stringWidth(graphemes[i]!.value));
            if (col + w > maxWidth && endChunk > startChunk) break;
            col += w;
            endChunk = i + 1;
        }
        const start = graphemes[startChunk]!.start;
        const end = graphemes[endChunk - 1]!.end;
        out.push(line.slice(start, end));
        startChunk = endChunk;
    }
    return out.length === 0 ? [''] : out;
}

/** 按显示宽度截取一行：跳过前 startCol 列，取最多 maxWidth 列。用于输入框水平视口，避免光标跑到屏幕外。 */
export function sliceLineByDisplayWidth(line: string, startCol: number, maxWidth: number): string {
    if (maxWidth <= 0) return '';
    const graphemes = splitGraphemes(line);
    if (graphemes.length === 0) return '';
    let col = 0;
    let startChunk = graphemes.length;
    for (let i = 0; i < graphemes.length; i += 1) {
        const w = Math.max(1, stringWidth(graphemes[i]!.value));
        if (col + w > startCol) {
            startChunk = i;
            break;
        }
        col += w;
    }
    if (startChunk >= graphemes.length) return '';
    col = 0;
    let endChunk = startChunk;
    for (let i = startChunk; i < graphemes.length; i += 1) {
        const w = Math.max(1, stringWidth(graphemes[i]!.value));
        if (col + w > maxWidth) break;
        col += w;
        endChunk = i + 1;
    }
    const startIndex = graphemes[startChunk]!.start;
    const endIndex = graphemes[endChunk - 1]!.end;
    return line.slice(startIndex, endIndex);
}

/** 给定一行和显示列数，返回对应的字符下标（用于点击定位光标）。 */
export function characterIndexAtDisplayColumn(line: string, displayCol: number): number {
    if (displayCol <= 0) return 0;
    const graphemes = splitGraphemes(line);
    let col = 0;
    for (const chunk of graphemes) {
        const w = Math.max(1, stringWidth(chunk.value));
        if (col + w > displayCol) return chunk.start;
        col += w;
    }
    return line.length;
}

function lineColumnToOffset(value: string, line: number, displayColumn: number): number {
    const lines = value.split('\n');
    const clampedLine = Math.max(0, Math.min(line, lines.length - 1));
    let offset = 0;
    for (let index = 0; index < clampedLine; index += 1) {
        offset += (lines[index]?.length ?? 0) + 1;
    }
    const targetLine = lines[clampedLine] ?? '';
    const targetIndex = characterIndexAtDisplayColumn(targetLine, Math.max(0, displayColumn));
    return clampOffset(value, offset + targetIndex);
}

function isWhitespace(char: string): boolean {
    return /\s/.test(char);
}

function findWordBoundaryBackward(value: string, from: number): number {
    let index = clampOffset(value, from);
    while (index > 0 && isWhitespace(value[index - 1] ?? '')) {
        index -= 1;
    }
    while (index > 0 && !isWhitespace(value[index - 1] ?? '')) {
        index -= 1;
    }
    return index;
}

function findWordBoundaryForward(value: string, from: number): number {
    let index = clampOffset(value, from);
    while (index < value.length && isWhitespace(value[index] ?? '')) {
        index += 1;
    }
    while (index < value.length && !isWhitespace(value[index] ?? '')) {
        index += 1;
    }
    return index;
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
        cursorPartOffset: model.attachments.length + countGraphemes(nextValue.slice(0, model.cursorOffset + text.length)),
        desiredDisplayColumn: undefined,
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
        cursorPartOffset: model.attachments.length + countGraphemes(nextValue.slice(0, model.cursorOffset + display.length)),
        pastePlaceholders: placeholders,
        desiredDisplayColumn: undefined,
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
            const deleteFrom = previousGraphemeOffset(model.value, model.cursorOffset);
            const nextValue = model.value.slice(0, deleteFrom) + model.value.slice(model.cursorOffset);
            return ensureEditorCursorVisible({
                ...model,
                value: nextValue,
                cursorOffset: deleteFrom,
                cursorPartOffset: model.attachments.length + countGraphemes(nextValue.slice(0, deleteFrom)),
                desiredDisplayColumn: undefined,
                maxVisibleRows: capVisibleRows(effectiveLineCount(nextValue, model.contentWidth)),
            });
        }
        case 'delete-forward': {
            if (model.cursorOffset >= model.value.length) return model;
            const deleteTo = nextGraphemeOffset(model.value, model.cursorOffset);
            const nextValue = model.value.slice(0, model.cursorOffset) + model.value.slice(deleteTo);
            return ensureEditorCursorVisible({
                ...model,
                value: nextValue,
                cursorPartOffset: model.attachments.length + countGraphemes(nextValue.slice(0, model.cursorOffset)),
                desiredDisplayColumn: undefined,
                maxVisibleRows: capVisibleRows(effectiveLineCount(nextValue, model.contentWidth)),
            });
        }
        case 'delete-to-line-start': {
            const cursor = offsetToEditorCursor(model.value, model.cursorOffset);
            const lines = model.value.split('\n');
            const lineStart = lines.slice(0, cursor.line).join('\n').length;
            if (model.cursorOffset <= lineStart) return model;
            const nextValue = model.value.slice(0, lineStart) + model.value.slice(model.cursorOffset);
            return ensureEditorCursorVisible({
                ...model,
                value: nextValue,
                cursorOffset: lineStart,
                cursorPartOffset: model.attachments.length + countGraphemes(nextValue.slice(0, lineStart)),
                desiredDisplayColumn: undefined,
            });
        }
        case 'delete-to-line-end': {
            const cursor = offsetToEditorCursor(model.value, model.cursorOffset);
            const lines = model.value.split('\n');
            let lineStart = 0;
            for (let i = 0; i < cursor.line; i += 1) {
                lineStart += (lines[i]?.length ?? 0) + 1;
            }
            const lineLength = lines[cursor.line]?.length ?? 0;
            const lineEnd = lineStart + lineLength;
            if (model.cursorOffset >= lineEnd) return model;
            const nextValue = model.value.slice(0, model.cursorOffset) + model.value.slice(lineEnd);
            return ensureEditorCursorVisible({
                ...model,
                value: nextValue,
                cursorPartOffset: model.attachments.length + countGraphemes(nextValue.slice(0, model.cursorOffset)),
                desiredDisplayColumn: undefined,
                maxVisibleRows: capVisibleRows(effectiveLineCount(nextValue, model.contentWidth)),
            });
        }
        case 'delete-word-backward': {
            const start = findWordBoundaryBackward(model.value, model.cursorOffset);
            if (start >= model.cursorOffset) {
                return model;
            }
            const nextValue = model.value.slice(0, start) + model.value.slice(model.cursorOffset);
            return ensureEditorCursorVisible({
                ...model,
                value: nextValue,
                cursorOffset: start,
                cursorPartOffset: model.attachments.length + countGraphemes(nextValue.slice(0, start)),
                desiredDisplayColumn: undefined,
                maxVisibleRows: capVisibleRows(effectiveLineCount(nextValue, model.contentWidth)),
            });
        }
        case 'move-horizontal':
            if (action.delta === 0) return model;
            if (action.delta < 0) {
                const nextOffset = previousGraphemeOffset(model.value, model.cursorOffset);
                return ensureEditorCursorVisible({
                    ...model,
                    cursorOffset: nextOffset,
                    cursorPartOffset: model.attachments.length + countGraphemes(model.value.slice(0, nextOffset)),
                    desiredDisplayColumn: undefined,
                });
            }
            {
                const nextOffset = nextGraphemeOffset(model.value, model.cursorOffset);
                return ensureEditorCursorVisible({
                    ...model,
                    cursorOffset: nextOffset,
                    cursorPartOffset: model.attachments.length + countGraphemes(model.value.slice(0, nextOffset)),
                    desiredDisplayColumn: undefined,
                });
            }
        case 'move-part-horizontal': {
            const current = model.cursorPartOffset ?? partOffsetFromCursor(model);
            return ensureEditorCursorVisible(applyPartOffset({ ...model, desiredDisplayColumn: undefined }, current + action.delta));
        }
        case 'delete-part-backward': {
            const current = model.cursorPartOffset ?? partOffsetFromCursor(model);
            if (current <= 0) return model;
            if (current <= model.attachments.length) {
                const removeIndex = current - 1;
                const next = {
                    ...model,
                    attachments: model.attachments.filter((_, idx) => idx !== removeIndex),
                    desiredDisplayColumn: undefined,
                };
                return ensureEditorCursorVisible(applyPartOffset(next, current - 1));
            }
            return reduceEditorModel(applyPartOffset(model, current), { type: 'delete-backward' });
        }
        case 'delete-part-forward': {
            const current = model.cursorPartOffset ?? partOffsetFromCursor(model);
            const total = model.attachments.length + countGraphemes(model.value);
            if (current >= total) return model;
            if (current < model.attachments.length) {
                const next = {
                    ...model,
                    attachments: model.attachments.filter((_, idx) => idx !== current),
                    desiredDisplayColumn: undefined,
                };
                return ensureEditorCursorVisible(applyPartOffset(next, current));
            }
            return reduceEditorModel(applyPartOffset(model, current), { type: 'delete-forward' });
        }
        case 'move-word': {
            const nextOffset = action.direction === 'backward'
                ? findWordBoundaryBackward(model.value, model.cursorOffset)
                : findWordBoundaryForward(model.value, model.cursorOffset);
            return ensureEditorCursorVisible({
                ...model,
                cursorOffset: nextOffset,
                cursorPartOffset: model.attachments.length + countGraphemes(model.value.slice(0, nextOffset)),
                desiredDisplayColumn: undefined,
            });
        }
        case 'move-vertical': {
            const cursor = offsetToEditorCursor(model.value, model.cursorOffset);
            const nextLine = Math.max(0, cursor.line + action.delta);
            const desiredDisplayColumn = model.desiredDisplayColumn ?? cursor.column;
            return ensureEditorCursorVisible({
                ...model,
                cursorOffset: lineColumnToOffset(model.value, nextLine, desiredDisplayColumn),
                cursorPartOffset: model.attachments.length + countGraphemes(model.value.slice(0, lineColumnToOffset(model.value, nextLine, desiredDisplayColumn))),
                desiredDisplayColumn,
            });
        }
        case 'move-boundary': {
            const cursor = offsetToEditorCursor(model.value, model.cursorOffset);
            const lines = model.value.split('\n');
            return ensureEditorCursorVisible({
                ...model,
                cursorOffset: lineColumnToOffset(model.value, cursor.line, action.edge === 'start' ? 0 : stringWidth(lines[cursor.line] ?? '')),
                cursorPartOffset: action.edge === 'start'
                    ? model.attachments.length + countGraphemes(model.value.slice(0, lineColumnToOffset(model.value, cursor.line, 0)))
                    : model.attachments.length + countGraphemes(model.value.slice(0, lineColumnToOffset(model.value, cursor.line, stringWidth(lines[cursor.line] ?? '')))),
                desiredDisplayColumn: undefined,
            });
        }
        case 'move-part-boundary': {
            const total = model.attachments.length + countGraphemes(model.value);
            return ensureEditorCursorVisible(applyPartOffset({ ...model, desiredDisplayColumn: undefined }, action.edge === 'start' ? 0 : total));
        }
        case 'set-visible-rows':
            return ensureEditorCursorVisible({ ...model, maxVisibleRows: Math.max(1, action.rows) });
        case 'set-value':
            {
                const nextOffset = action.cursorOffset === undefined ? action.value.length : clampOffset(action.value, action.cursorOffset);
                return ensureEditorCursorVisible({
                    ...model,
                    value: action.value,
                    cursorOffset: nextOffset,
                    cursorPartOffset: model.attachments.length + countGraphemes(action.value.slice(0, nextOffset)),
                    maxVisibleRows: capVisibleRows(effectiveLineCount(action.value, model.contentWidth)),
                    pastePlaceholders: action.value.length === 0 ? [] : model.pastePlaceholders,
                    desiredDisplayColumn: undefined,
                });
            }
        case 'append-attachment':
            {
                const next = { ...model, attachments: [...model.attachments, action.attachment] };
                const current = model.cursorPartOffset ?? partOffsetFromCursor(model);
                const nextPart = current + 1;
                return applyPartOffset(next, nextPart);
            }
        case 'remove-attachment':
            {
                const idx = model.attachments.findIndex((attachment) => attachment.id === action.id);
                if (idx < 0) return model;
                const next = { ...model, attachments: model.attachments.filter((attachment) => attachment.id !== action.id) };
                const current = model.cursorPartOffset ?? partOffsetFromCursor(model);
                const nextPart = current > idx ? current - 1 : current;
                return applyPartOffset(next, nextPart);
            }
        case 'clear-attachments':
            {
                const current = model.cursorPartOffset ?? partOffsetFromCursor(model);
                const next = { ...model, attachments: [] };
                return applyPartOffset(next, Math.max(0, current - model.attachments.length));
            }
        case 'apply-external-editor':
            return ensureEditorCursorVisible({
                ...model,
                value: action.value,
                cursorOffset: action.value.length,
                cursorPartOffset: model.attachments.length + countGraphemes(action.value),
                desiredDisplayColumn: undefined,
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
    const cw = contentWidth ?? model.contentWidth ?? 0;
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
