/**
 * Editor layout and terminal cursor helpers.
 * Shared by Editor and TextAreaInput so the input component can own cursor sync.
 */

import type { DOMElement } from 'ink';
import stringWidth from 'string-width';
import { clampOffset, offsetToLineColumn } from './editor-model.js';

export const PROMPT_TEXT = '> ';
export const CONTINUATION_PROMPT_TEXT = '  ';

export interface WrappedEditorRow {
    lineIndex: number;
    prefix: string;
    text: string;
    startIndex: number;
    endIndex: number;
}

export interface WrappedEditorLayout {
    rows: WrappedEditorRow[];
    cursor: {
        x: number;
        y: number;
        absoluteRow: number;
        visibleStartRow: number;
        /** Index relative to row.text where software cursor should be rendered */
        cursorIndexInRow?: number;
    };
}

function charDisplayWidth(char: string): number {
    return stringWidth(char);
}

function stringDisplayWidth(str: string): number {
    return stringWidth(str);
}

function getRowCapacity(width: number, prefix: string): number {
    return Math.max(1, width - stringDisplayWidth(prefix));
}

function getRowDisplayWidth(row: WrappedEditorRow): number {
    return stringDisplayWidth(row.prefix) + stringDisplayWidth(row.text);
}

export function wrapEditorLine(
    line: string,
    width: number,
    prompt: string,
    lineIndex: number,
): WrappedEditorRow[] {
    const safeWidth = Math.max(1, width);
    const rows: WrappedEditorRow[] = [];
    const displayLine = line; // 移除空行变空格的逻辑，空行应该由 empty row 表达

    let currentPrefix = prompt;
    let currentCapacity = getRowCapacity(safeWidth, currentPrefix);
    let currentText = '';
    let currentWidth = 0;
    let rowStart = 0;
    let sourceIndex = 0;

    const pushRow = (endIndex: number): void => {
        rows.push({
            lineIndex,
            prefix: currentPrefix,
            text: currentText,
            startIndex: rowStart,
            endIndex,
        });
        currentPrefix = '';
        currentCapacity = getRowCapacity(safeWidth, currentPrefix);
        currentText = '';
        currentWidth = 0;
        rowStart = endIndex;
    };

    if (displayLine.length === 0) {
        pushRow(0);
        return rows;
    }

    for (const char of displayLine) {
        const charStart = sourceIndex;
        sourceIndex += char.length;
        const widthDelta = charDisplayWidth(char);

        if (currentText.length > 0 && currentWidth + widthDelta > currentCapacity) {
            pushRow(charStart);
        }

        currentText += char;
        currentWidth += widthDelta;
    }

    pushRow(sourceIndex);
    return rows;
}

export function buildWrappedEditorLayout(
    value: string,
    cursorOffset: number,
    width: number,
    maxVisibleRows: number,
    // Legacy escape hatch kept for helper/test compatibility.
    // Runtime editor rendering now uses exact cursor offsets instead.
    forceEnd?: boolean,
): WrappedEditorLayout {
    const safeWidth = Math.max(1, width);
    const safeMaxVisibleRows = Math.max(1, maxVisibleRows);
    const safeOffset = clampOffset(value, cursorOffset);
    const targetOffset = forceEnd ? value.length : safeOffset;
    const cursor = offsetToLineColumn(value, targetOffset);
    const lines = value.split('\n');
    const rows: WrappedEditorRow[] = [];

    let cursorAbsoluteRow = 0;
    let cursorX = stringDisplayWidth(PROMPT_TEXT);
    let cursorIndexInRow: number | undefined = undefined;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex] ?? '';
        const prompt = lineIndex === 0 ? PROMPT_TEXT : CONTINUATION_PROMPT_TEXT;
        const wrappedRows = wrapEditorLine(line, safeWidth, prompt, lineIndex);
        rows.push(...wrappedRows);
    }

    ensureTrailingCursorRow({
        rows,
        lines,
        width: safeWidth,
        cursor,
        targetOffset,
        value,
    });

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex]!;
        const line = lines[row.lineIndex] ?? '';
        const nextRow = rows[rowIndex + 1];
        const nextRowStartsAtCursor = nextRow?.lineIndex === row.lineIndex && nextRow.startIndex === cursor.column;
        const cursorInRow = forceEnd
            ? rowIndex === rows.length - 1
            : row.lineIndex === cursor.line && (
                (cursor.column >= row.startIndex && cursor.column < row.endIndex)
                || (cursor.column === row.endIndex && !nextRowStartsAtCursor)
            );

        if (cursorInRow) {
            cursorAbsoluteRow = rowIndex;
            const textBeforeCursor = line.slice(row.startIndex, Math.min(cursor.column, row.endIndex));
            cursorX = stringDisplayWidth(row.prefix) + stringDisplayWidth(textBeforeCursor);
            cursorIndexInRow = Math.max(0, cursor.column - row.startIndex);
        }
    }

    const cursorAtBottom = forceEnd || cursorAbsoluteRow >= rows.length - safeMaxVisibleRows;
    const visibleStartRow = cursorAtBottom
        ? Math.max(0, rows.length - safeMaxVisibleRows)
        : Math.max(0, cursorAbsoluteRow - safeMaxVisibleRows + 1);

    return {
        rows,
        cursor: {
            x: cursorX,
            y: cursorAbsoluteRow - visibleStartRow,
            absoluteRow: cursorAbsoluteRow,
            visibleStartRow,
            cursorIndexInRow,
        },
    };
}

function ensureTrailingCursorRow(params: {
    rows: WrappedEditorRow[];
    lines: string[];
    width: number;
    cursor: { line: number; column: number };
    targetOffset: number;
    value: string;
}): void {
    const lastRow = params.rows.at(-1);
    const lastLineIndex = params.lines.length - 1;
    const lastLine = params.lines[lastLineIndex] ?? '';

    if (!lastRow) {
        params.rows.push({
            lineIndex: 0,
            prefix: PROMPT_TEXT,
            text: '',
            startIndex: 0,
            endIndex: 0,
        });
        return;
    }

    const cursorAtEndOfValue = params.targetOffset === params.value.length;
    const cursorAtEndOfLastLine = params.cursor.line === lastLineIndex && params.cursor.column === lastLine.length;
    const rowEndsAtLastLine = lastRow.lineIndex === lastLineIndex && lastRow.endIndex === lastLine.length;
    const rowIsFull = getRowDisplayWidth(lastRow) >= params.width;

    if (!cursorAtEndOfValue || !cursorAtEndOfLastLine || !rowEndsAtLastLine || !rowIsFull) {
        return;
    }

    params.rows.push({
        lineIndex: lastLineIndex,
        prefix: '',
        text: ' ',
        startIndex: lastRow.endIndex,
        endIndex: lastRow.endIndex,
    });
}

export function measureEditorRows(value: string, width: number): number {
    return buildWrappedEditorLayout(value, value.length, width, Number.MAX_SAFE_INTEGER).rows.length;
}

export function clampTerminalCoordinate(value: number, limit: number | undefined): number {
    const normalized = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
        return normalized;
    }
    return Math.min(normalized, limit - 1);
}

export function buildTerminalCursorPosition(params: {
    anchorX: number;
    anchorY: number;
    cursorX: number;
    columns?: number;
    rows?: number;
    offsetX?: number;
    offsetY?: number;
}): { x: number; y: number } {
    const {
        anchorX,
        anchorY,
        cursorX,
        columns,
        rows,
        offsetX = 0,
        offsetY = 0,
    } = params;

    return {
        x: clampTerminalCoordinate(anchorX + cursorX + offsetX, columns),
        y: clampTerminalCoordinate(anchorY + offsetY, rows),
    };
}

export function getAbsolutePosition(element: DOMElement): { x: number; y: number } {
    let x = 0;
    let y = 0;
    let current: DOMElement | undefined = element;

    while (current?.yogaNode) {
        x += current.yogaNode.getComputedLeft();
        y += current.yogaNode.getComputedTop();
        current = current.parentNode;
    }

    return { x, y };
}

export function truncateDisplayText(str: string, maxWidth: number): string {
    if (maxWidth <= 0) return '';
    if (stringDisplayWidth(str) <= maxWidth) return str;
    if (maxWidth === 1) return '…';

    let width = 0;
    let out = '';
    const target = maxWidth - 1;
    for (const char of str) {
        const charWidth = charDisplayWidth(char);
        if (width + charWidth > target) break;
        out += char;
        width += charWidth;
    }
    return `${out}…`;
}

export function padDisplayText(str: string, width: number): string {
    const current = stringDisplayWidth(str);
    if (current >= width) return str;
    return `${str}${' '.repeat(width - current)}`;
}
