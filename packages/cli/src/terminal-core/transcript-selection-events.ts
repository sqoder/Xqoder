import type { TerminalCoreEvent } from './types.js';
import { normalizeViewportSelection } from './viewport-model.js';

export interface TranscriptSelectionPoint {
    line: number;
    column: number;
}

function normalizePoint(point: TranscriptSelectionPoint): TranscriptSelectionPoint {
    return {
        line: Math.max(0, Math.trunc(point.line)),
        column: Math.max(0, Math.trunc(point.column)),
    };
}

export function normalizeTranscriptSelection(
    start: TranscriptSelectionPoint,
    end: TranscriptSelectionPoint,
): { start: TranscriptSelectionPoint; end: TranscriptSelectionPoint } {
    const normalizedStart = normalizePoint(start);
    const normalizedEnd = normalizePoint(end);
    return normalizeViewportSelection(normalizedStart, normalizedEnd);
}

/**
 * 统一 transcript 选区事件：
 * - 焦点始终跟随 end 点
 * - 选区 start/end 只在这里做非负整数归一化
 */
export function createTranscriptSelectionEvents(
    start: TranscriptSelectionPoint,
    end: TranscriptSelectionPoint,
): [TerminalCoreEvent, TerminalCoreEvent] {
    const normalizedEndPoint = normalizePoint(end);
    const normalizedSelection = normalizeTranscriptSelection(start, end);
    return [
        { type: 'viewport.focusLine.set', line: normalizedEndPoint.line },
        {
            type: 'viewport.selection.set',
            selection: normalizedSelection,
        },
    ];
}
