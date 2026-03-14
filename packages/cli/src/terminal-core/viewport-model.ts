import stringWidth from 'string-width';

export interface ViewportPoint {
    line: number;
    column: number;
}

export interface ViewportSelection {
    start: ViewportPoint;
    end: ViewportPoint;
}

export interface ScrollbarModel {
    visible: boolean;
    thumbTop: number;
    thumbHeight: number;
    trackHeight: number;
}

export interface ViewportModel {
    topLine: number;
    autoFollow: boolean;
    selection: ViewportSelection | null;
    /** 光标/鼠标所在的 transcript 行号，用于「拖到哪段复制哪段」 */
    focusLine: number | null;
}

export function createViewportModel(): ViewportModel {
    return {
        topLine: 0,
        autoFollow: true,
        selection: null,
        focusLine: null,
    };
}

export function getViewportVisibleCapacity(height: number): number {
    return Math.max(1, height);
}

export function getViewportMaxTopLine(lineCount: number, height: number): number {
    return Math.max(0, lineCount - getViewportVisibleCapacity(height));
}

export function syncViewportModel(
    model: ViewportModel,
    options: { lineCount: number; previousLineCount: number; height: number },
): ViewportModel {
    const maxTopLine = getViewportMaxTopLine(options.lineCount, options.height);
    if (model.autoFollow) {
        return {
            ...model,
            topLine: maxTopLine,
        };
    }

    if (options.lineCount < options.previousLineCount) {
        return {
            ...model,
            topLine: Math.min(model.topLine, maxTopLine),
        };
    }

    return model;
}

export function scrollViewportModel(model: ViewportModel, delta: number, lineCount: number, height: number): ViewportModel {
    const maxTopLine = getViewportMaxTopLine(lineCount, height);
    if (delta < 0) {
        return {
            ...model,
            autoFollow: false,
            topLine: Math.max(0, model.topLine + delta),
            selection: null,
        };
    }

    const nextTopLine = Math.min(maxTopLine, model.topLine + delta);
    return {
        ...model,
        autoFollow: nextTopLine >= maxTopLine,
        topLine: nextTopLine,
        selection: null,
    };
}

export function pageViewportModel(model: ViewportModel, direction: 'up' | 'down', lineCount: number, height: number): ViewportModel {
    const delta = Math.max(1, Math.floor(height * 0.6));
    return scrollViewportModel(model, direction === 'up' ? -delta : delta, lineCount, height);
}

export function moveViewportModelToTop(model: ViewportModel): ViewportModel {
    return {
        ...model,
        autoFollow: false,
        topLine: 0,
        selection: null,
    };
}

export function moveViewportModelToBottom(model: ViewportModel, lineCount: number, height: number): ViewportModel {
    return {
        ...model,
        autoFollow: true,
        topLine: getViewportMaxTopLine(lineCount, height),
        selection: null,
    };
}

/** 设置绝对滚动位置（用于导航条拖动快速定位） */
export function setViewportTopLine(model: ViewportModel, topLine: number, lineCount: number, height: number): ViewportModel {
    const maxTopLine = getViewportMaxTopLine(lineCount, height);
    const clamped = Math.max(0, Math.min(maxTopLine, topLine));
    return {
        ...model,
        autoFollow: clamped >= maxTopLine,
        topLine: clamped,
        selection: null,
    };
}

export function normalizeViewportSelection(start: ViewportPoint, end: ViewportPoint): ViewportSelection {
    if (start.line < end.line) {
        return { start, end };
    }
    if (start.line > end.line) {
        return { start: end, end: start };
    }
    return start.column <= end.column ? { start, end } : { start: end, end: start };
}

export function displayColumnToIndex(text: string, column: number): number {
    let width = 0;
    let index = 0;
    for (const char of text) {
        const nextWidth = width + Math.max(1, stringWidth(char));
        if (nextWidth > column) {
            break;
        }
        width = nextWidth;
        index += char.length;
    }
    return index;
}

export function buildViewportSelectedText(lines: string[], selection: ViewportSelection | null): string {
    if (!selection) {
        return '';
    }

    const normalized = normalizeViewportSelection(selection.start, selection.end);
    const chunks: string[] = [];

    for (let index = normalized.start.line; index <= normalized.end.line; index += 1) {
        const line = lines[index] ?? '';
        const startIndex = index === normalized.start.line ? displayColumnToIndex(line, normalized.start.column) : 0;
        const endIndex = index === normalized.end.line ? displayColumnToIndex(line, normalized.end.column) : line.length;
        chunks.push(line.slice(startIndex, Math.max(startIndex, endIndex)));
    }

    return chunks.join('\n');
}

/**
 * 滚动状态（与「导航条 / 历史位置条」文档一致）
 * contentHeight=总行数, viewportHeight=可见行数, scrollTop=当前滚动偏移(行)
 */
export interface ScrollState {
    contentHeight: number;
    viewportHeight: number;
    scrollTop: number;
}

const MIN_THUMB_ROWS = 3;

/**
 * 根据滚动状态计算轨道上滑块的 top 与 height（与文档公式一致）
 * thumbHeight = max(minThumb, viewportHeight/contentHeight * trackHeight)
 * thumbTop = scrollTop / (contentHeight - viewportHeight) * (trackHeight - thumbHeight)
 */
export function getScrollbarThumb(state: ScrollState, trackHeight: number): { top: number; height: number } {
    const { contentHeight, viewportHeight, scrollTop } = state;
    if (contentHeight <= viewportHeight) {
        return { top: 0, height: trackHeight };
    }
    const height = Math.max(
        MIN_THUMB_ROWS,
        Math.floor((viewportHeight / contentHeight) * trackHeight),
    );
    const maxTop = Math.max(0, trackHeight - height);
    const scrollRange = contentHeight - viewportHeight;
    const top = scrollRange <= 0 ? 0 : Math.floor((scrollTop / scrollRange) * maxTop);
    return { top: Math.min(top, maxTop), height };
}

export function buildScrollbarModel(lineCount: number, height: number, topLine: number): ScrollbarModel {
    const trackHeight = Math.max(1, height);
    const visibleCapacity = getViewportVisibleCapacity(height);
    if (lineCount <= visibleCapacity) {
        return {
            visible: false,
            thumbTop: 0,
            thumbHeight: trackHeight,
            trackHeight,
        };
    }
    const state: ScrollState = {
        contentHeight: lineCount,
        viewportHeight: visibleCapacity,
        scrollTop: Math.min(topLine, getViewportMaxTopLine(lineCount, height)),
    };
    const { top: thumbTop, height: thumbHeight } = getScrollbarThumb(state, trackHeight);
    return {
        visible: true,
        thumbTop,
        thumbHeight,
        trackHeight,
    };
}

export function resolveViewportTopLineFromScrollbar(lineCount: number, height: number, pointerRow: number, dragOffset: number = 0): number {
    const scrollbar = buildScrollbarModel(lineCount, height, 0);
    const maxTopLine = getViewportMaxTopLine(lineCount, height);
    if (!scrollbar.visible || maxTopLine === 0) {
        return 0;
    }

    const maxThumbTop = Math.max(0, scrollbar.trackHeight - scrollbar.thumbHeight);
    if (maxThumbTop === 0) {
        return 0;
    }

    const thumbTop = Math.max(0, Math.min(maxThumbTop, pointerRow - dragOffset));
    return Math.round((thumbTop / maxThumbTop) * maxTopLine);
}

export function getViewportVisibleLines(lines: string[], model: ViewportModel, height: number): string[] {
    return lines.slice(model.topLine, model.topLine + getViewportVisibleCapacity(height));
}
