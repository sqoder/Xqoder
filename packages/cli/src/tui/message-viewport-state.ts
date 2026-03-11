export interface TranscriptSelectionPoint {
    line: number;
    column: number;
}

export interface TranscriptSelectionRange {
    start: TranscriptSelectionPoint;
    end: TranscriptSelectionPoint;
}

export interface SelectionLineSegments {
    before: string;
    selected: string;
    after: string;
}

export interface MessageViewportState {
    topLine: number;
    autoFollow: boolean;
    selectionRange: TranscriptSelectionRange | null;
}

export interface ScrollbarMetrics {
    visible: boolean;
    thumbTop: number;
    thumbHeight: number;
    trackHeight: number;
}

export function createInitialMessageViewportState(): MessageViewportState {
    return {
        topLine: 0,
        autoFollow: true,
        selectionRange: null,
    };
}

export function getTranscriptVisibleCapacity(height: number): number {
    return Math.max(1, height);
}

export function getTranscriptMaxTopLine(lineCount: number, height: number): number {
    return Math.max(0, lineCount - getTranscriptVisibleCapacity(height));
}

export function syncMessageViewport(
    state: MessageViewportState,
    options: { lineCount: number; previousLineCount: number; height: number },
): MessageViewportState {
    const maxTopLine = getTranscriptMaxTopLine(options.lineCount, options.height);

    if (state.autoFollow) {
        return {
            ...state,
            topLine: maxTopLine,
        };
    }

    if (options.lineCount < options.previousLineCount) {
        return {
            ...state,
            topLine: Math.min(state.topLine, maxTopLine),
        };
    }

    return state;
}

export function scrollMessageViewport(
    state: MessageViewportState,
    delta: number,
    lineCount: number,
    height: number,
): MessageViewportState {
    const maxTopLine = getTranscriptMaxTopLine(lineCount, height);
    if (delta < 0) {
        return {
            ...state,
            autoFollow: false,
            topLine: Math.max(0, state.topLine + delta),
            selectionRange: null,
        };
    }

    const nextTopLine = Math.min(maxTopLine, state.topLine + delta);
    return {
        ...state,
        autoFollow: nextTopLine >= maxTopLine,
        topLine: nextTopLine,
        selectionRange: null,
    };
}

export function pageMessageViewport(
    state: MessageViewportState,
    direction: 'up' | 'down',
    lineCount: number,
    height: number,
): MessageViewportState {
    const delta = Math.max(1, Math.floor(height * 0.6));
    return scrollMessageViewport(state, direction === 'up' ? -delta : delta, lineCount, height);
}

export function moveMessageViewportByHalfPage(
    state: MessageViewportState,
    direction: 'up' | 'down',
    lineCount: number,
    height: number,
): MessageViewportState {
    const delta = Math.max(1, Math.floor(height / 2));
    return scrollMessageViewport(state, direction === 'up' ? -delta : delta, lineCount, height);
}

export function moveMessageViewportToTop(state: MessageViewportState): MessageViewportState {
    return {
        ...state,
        autoFollow: false,
        topLine: 0,
        selectionRange: null,
    };
}

export function moveMessageViewportToBottom(
    state: MessageViewportState,
    lineCount: number,
    height: number,
): MessageViewportState {
    return {
        ...state,
        autoFollow: true,
        topLine: getTranscriptMaxTopLine(lineCount, height),
        selectionRange: null,
    };
}

function charDisplayWidth(char: string): number {
    return /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char) ? 2 : 1;
}

export function getDisplayWidth(text: string): number {
    let width = 0;
    for (const char of text) {
        width += charDisplayWidth(char);
    }
    return width;
}

export function displayColumnToStringIndex(text: string, column: number): number {
    let width = 0;
    let index = 0;

    for (const char of text) {
        const nextWidth = width + charDisplayWidth(char);
        if (nextWidth > column) {
            break;
        }
        width = nextWidth;
        index += char.length;
    }

    return index;
}

export function normalizeSelectionRange(start: TranscriptSelectionPoint, end: TranscriptSelectionPoint): TranscriptSelectionRange {
    if (start.line < end.line) {
        return { start, end };
    }

    if (start.line > end.line) {
        return { start: end, end: start };
    }

    return start.column <= end.column
        ? { start, end }
        : { start: end, end: start };
}

export function buildTranscriptSelectionText(
    lines: string[],
    start: TranscriptSelectionPoint,
    end: TranscriptSelectionPoint,
): string {
    const range = normalizeSelectionRange(start, end);
    const selectedLines: string[] = [];

    for (let lineIndex = range.start.line; lineIndex <= range.end.line; lineIndex += 1) {
        const line = lines[lineIndex] ?? '';
        const startIndex = lineIndex === range.start.line
            ? displayColumnToStringIndex(line, range.start.column)
            : 0;
        const endIndex = lineIndex === range.end.line
            ? displayColumnToStringIndex(line, range.end.column)
            : line.length;
        selectedLines.push(line.slice(startIndex, Math.max(startIndex, endIndex)));
    }

    return selectedLines.join('\n');
}

export function hasSelectionDragExceededThreshold(
    start: TranscriptSelectionPoint,
    end: TranscriptSelectionPoint,
    threshold: number = 1,
): boolean {
    if (start.line !== end.line) {
        return true;
    }

    return Math.abs(start.column - end.column) >= threshold;
}

export function buildSelectionLineSegments(
    line: string,
    lineIndex: number,
    range: TranscriptSelectionRange | null,
): SelectionLineSegments | null {
    if (!range || lineIndex < range.start.line || lineIndex > range.end.line) {
        return null;
    }

    const startColumn = lineIndex === range.start.line ? range.start.column : 0;
    const endColumn = lineIndex === range.end.line ? range.end.column : getDisplayWidth(line);
    if (endColumn <= startColumn) {
        return null;
    }

    const startIndex = displayColumnToStringIndex(line, startColumn);
    const endIndex = displayColumnToStringIndex(line, endColumn);

    return {
        before: line.slice(0, startIndex),
        selected: line.slice(startIndex, Math.max(startIndex, endIndex)),
        after: line.slice(Math.max(startIndex, endIndex)),
    };
}

export function buildScrollbarMetrics(lineCount: number, height: number, topLine: number): ScrollbarMetrics {
    const trackHeight = Math.max(1, height);
    const visibleCapacity = getTranscriptVisibleCapacity(height);
    if (lineCount <= visibleCapacity) {
        return {
            visible: false,
            thumbTop: 0,
            thumbHeight: trackHeight,
            trackHeight,
        };
    }

    const maxTopLine = getTranscriptMaxTopLine(lineCount, height);
    const thumbHeight = Math.max(Math.min(3, trackHeight), Math.floor((visibleCapacity / lineCount) * trackHeight));
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const clampedTopLine = Math.max(0, Math.min(topLine, maxTopLine));
    const thumbTop = maxTopLine === 0
        ? 0
        : Math.round((clampedTopLine / maxTopLine) * maxThumbTop);

    return {
        visible: true,
        thumbTop,
        thumbHeight,
        trackHeight,
    };
}

export function resolveTopLineFromScrollbar(lineCount: number, height: number, pointerRow: number, dragOffset: number = 0): number {
    const metrics = buildScrollbarMetrics(lineCount, height, 0);
    const maxTopLine = getTranscriptMaxTopLine(lineCount, height);
    if (!metrics.visible || maxTopLine === 0) {
        return 0;
    }

    const maxThumbTop = Math.max(0, metrics.trackHeight - metrics.thumbHeight);
    if (maxThumbTop === 0) {
        return 0;
    }

    const centeredThumbTop = Math.max(0, Math.min(maxThumbTop, pointerRow - dragOffset));
    return Math.round((centeredThumbTop / maxThumbTop) * maxTopLine);
}
