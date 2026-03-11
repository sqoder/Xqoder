import stringWidth from 'string-width';

export interface EditorAttachment {
    id: string;
    label: string;
    kind: 'file' | 'image' | 'text';
    path?: string;
}

export interface EditorModel {
    value: string;
    cursorOffset: number;
    scrollRow: number;
    maxVisibleRows: number;
    attachments: EditorAttachment[];
    placeholder: string;
}

export type EditorAction =
    | { type: 'insert-text'; text: string }
    | { type: 'paste'; text: string }
    | { type: 'delete-backward' }
    | { type: 'delete-forward' }
    | { type: 'move-horizontal'; delta: number }
    | { type: 'move-vertical'; delta: number }
    | { type: 'move-boundary'; edge: 'start' | 'end' }
    | { type: 'set-visible-rows'; rows: number }
    | { type: 'set-value'; value: string; cursorOffset?: number }
    | { type: 'append-attachment'; attachment: EditorAttachment }
    | { type: 'remove-attachment'; id: string }
    | { type: 'clear-attachments' }
    | { type: 'apply-external-editor'; value: string };

export interface EditorCursorPosition {
    line: number;
    column: number;
}

export interface EditorViewModel {
    lines: string[];
    cursor: EditorCursorPosition;
    visibleLines: string[];
    visibleStartRow: number;
}

export function createEditorModel(options: Partial<Pick<EditorModel, 'value' | 'placeholder' | 'maxVisibleRows'>> = {}): EditorModel {
    const value = options.value ?? '';
    return {
        value,
        cursorOffset: value.length,
        scrollRow: 0,
        maxVisibleRows: options.maxVisibleRows ?? 4,
        attachments: [],
        placeholder: options.placeholder ?? 'Type a message...',
    };
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

function lineColumnToOffset(value: string, line: number, column: number): number {
    const lines = value.split('\n');
    let offset = 0;
    for (let index = 0; index < Math.min(line, lines.length - 1); index += 1) {
        offset += (lines[index]?.length ?? 0) + 1;
    }
    return clampOffset(value, offset + Math.min(column, lines[Math.min(line, lines.length - 1)]?.length ?? 0));
}

function ensureEditorCursorVisible(model: EditorModel): EditorModel {
    const cursor = offsetToEditorCursor(model.value, model.cursorOffset);
    if (cursor.line < model.scrollRow) {
        return { ...model, scrollRow: cursor.line };
    }
    const maxVisibleRow = model.scrollRow + Math.max(1, model.maxVisibleRows) - 1;
    if (cursor.line > maxVisibleRow) {
        return { ...model, scrollRow: cursor.line - Math.max(1, model.maxVisibleRows) + 1 };
    }
    return model;
}

function insertText(model: EditorModel, text: string): EditorModel {
    const nextValue = model.value.slice(0, model.cursorOffset) + text + model.value.slice(model.cursorOffset);
    return ensureEditorCursorVisible({
        ...model,
        value: nextValue,
        cursorOffset: model.cursorOffset + text.length,
    });
}

export function reduceEditorModel(model: EditorModel, action: EditorAction): EditorModel {
    switch (action.type) {
        case 'insert-text':
        case 'paste':
            return insertText(model, action.text);
        case 'delete-backward': {
            if (model.cursorOffset === 0) return model;
            const nextValue = model.value.slice(0, model.cursorOffset - 1) + model.value.slice(model.cursorOffset);
            return ensureEditorCursorVisible({ ...model, value: nextValue, cursorOffset: model.cursorOffset - 1 });
        }
        case 'delete-forward': {
            if (model.cursorOffset >= model.value.length) return model;
            const nextValue = model.value.slice(0, model.cursorOffset) + model.value.slice(model.cursorOffset + 1);
            return ensureEditorCursorVisible({ ...model, value: nextValue });
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
            });
        case 'append-attachment':
            return { ...model, attachments: [...model.attachments, action.attachment] };
        case 'remove-attachment':
            return { ...model, attachments: model.attachments.filter((attachment) => attachment.id !== action.id) };
        case 'clear-attachments':
            return { ...model, attachments: [] };
        case 'apply-external-editor':
            return ensureEditorCursorVisible({ ...model, value: action.value, cursorOffset: action.value.length });
        default:
            return model;
    }
}

export function getEditorViewModel(model: EditorModel): EditorViewModel {
    const lines = model.value.length === 0 ? [''] : model.value.split('\n');
    const cursor = offsetToEditorCursor(model.value, model.cursorOffset);
    const visibleStartRow = Math.max(0, Math.min(model.scrollRow, Math.max(0, lines.length - model.maxVisibleRows)));
    return {
        lines,
        cursor,
        visibleStartRow,
        visibleLines: lines.slice(visibleStartRow, visibleStartRow + model.maxVisibleRows),
    };
}
