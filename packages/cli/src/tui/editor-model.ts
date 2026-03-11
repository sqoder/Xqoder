export interface CursorPosition {
    line: number;
    column: number;
}

export interface VerticalMoveResult {
    offset: number;
    preferredColumn: number;
}

export function clampOffset(value: string, offset: number): number {
    return Math.max(0, Math.min(value.length, offset));
}

export function offsetToLineColumn(value: string, offset: number): CursorPosition {
    const safeOffset = clampOffset(value, offset);
    const before = value.slice(0, safeOffset);
    const segments = before.split('\n');
    const line = Math.max(0, segments.length - 1);
    const column = segments.at(-1)?.length ?? 0;
    return { line, column };
}

export function lineColumnToOffset(value: string, line: number, column: number): number {
    const lines = value.split('\n');
    const safeLine = Math.max(0, Math.min(lines.length - 1, line));
    const safeColumn = Math.max(0, Math.min(lines[safeLine]?.length ?? 0, column));

    let offset = 0;
    for (let index = 0; index < safeLine; index += 1) {
        offset += (lines[index]?.length ?? 0) + 1;
    }

    return offset + safeColumn;
}

export function insertTextAtOffset(value: string, offset: number, text: string): { value: string; offset: number } {
    const safeOffset = clampOffset(value, offset);
    const nextValue = value.slice(0, safeOffset) + text + value.slice(safeOffset);
    return {
        value: nextValue,
        offset: safeOffset + text.length,
    };
}

export function deleteBackwardAtOffset(value: string, offset: number): { value: string; offset: number } {
    const safeOffset = clampOffset(value, offset);
    if (safeOffset === 0) {
        return { value, offset: safeOffset };
    }

    return {
        value: value.slice(0, safeOffset - 1) + value.slice(safeOffset),
        offset: safeOffset - 1,
    };
}

export function moveCursorHorizontal(value: string, offset: number, delta: -1 | 1): number {
    return clampOffset(value, offset + delta);
}

export function moveCursorVertical(
    value: string,
    offset: number,
    delta: -1 | 1,
    preferredColumn?: number,
): VerticalMoveResult {
    const current = offsetToLineColumn(value, offset);
    const lines = value.split('\n');
    const targetLine = Math.max(0, Math.min(lines.length - 1, current.line + delta));
    const targetColumn = Math.max(0, Math.min(lines[targetLine]?.length ?? 0, preferredColumn ?? current.column));

    return {
        offset: lineColumnToOffset(value, targetLine, targetColumn),
        preferredColumn: preferredColumn ?? current.column,
    };
}
