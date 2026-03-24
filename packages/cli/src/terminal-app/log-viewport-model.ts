import { rustTui, type LogViewportIntent } from '../terminal-core/rust-tui.js';
import type { ViewportModel } from '../terminal-core/viewport-model.js';

export interface LogViewportGeometry {
    contentWidth: number;
    height: number;
}

function withLogViewportProjection(
    model: ViewportModel,
    geometry: LogViewportGeometry,
    clearSelection = false,
): ViewportModel {
    const viewport = rustTui.queryLogViewport();
    return {
        ...model,
        scrollOffset: viewport.scrollOffset,
        isFollowingBottom: viewport.isFollowingBottom,
        viewportHeight: geometry.height,
        ...(clearSelection ? { selectedRange: null } : {}),
    };
}

export function syncLogViewportModel(
    model: ViewportModel,
    logLines: string[],
    geometry: LogViewportGeometry,
): ViewportModel {
    rustTui.refreshLogViewport(logLines, geometry.contentWidth, geometry.height);
    return withLogViewportProjection(model, geometry);
}

function applyLogViewportIntent(
    model: ViewportModel,
    logLines: string[],
    geometry: LogViewportGeometry,
    intent: LogViewportIntent,
    clearSelection = true,
): ViewportModel {
    rustTui.refreshLogViewport(logLines, geometry.contentWidth, geometry.height);
    rustTui.applyLogViewportIntent(intent);
    return withLogViewportProjection(model, geometry, clearSelection);
}

export function scrollLogViewportModel(
    model: ViewportModel,
    delta: number,
    logLines: string[],
    geometry: LogViewportGeometry,
): ViewportModel {
    return applyLogViewportIntent(model, logLines, geometry, { kind: 'delta', delta });
}

export function pageLogViewportModel(
    model: ViewportModel,
    direction: 'up' | 'down',
    logLines: string[],
    geometry: LogViewportGeometry,
): ViewportModel {
    const pageSize = Math.max(1, Math.floor(geometry.height * 0.85));
    return applyLogViewportIntent(model, logLines, geometry, {
        kind: 'page',
        direction,
        pageSize,
    });
}

export function moveLogViewportToTop(
    model: ViewportModel,
    logLines: string[],
    geometry: LogViewportGeometry,
): ViewportModel {
    return applyLogViewportIntent(model, logLines, geometry, { kind: 'home' });
}

export function moveLogViewportToBottom(
    model: ViewportModel,
    logLines: string[],
    geometry: LogViewportGeometry,
): ViewportModel {
    return applyLogViewportIntent(model, logLines, geometry, { kind: 'end' });
}

export function setLogViewportTopLine(
    model: ViewportModel,
    topLine: number,
    logLines: string[],
    geometry: LogViewportGeometry,
): ViewportModel {
    return applyLogViewportIntent(model, logLines, geometry, {
        kind: 'set-top-line',
        topLine: Math.max(0, Math.trunc(topLine)),
    });
}

export function setLogViewportFromScrollbar(
    model: ViewportModel,
    pointerRow: number,
    dragOffset: number,
    logLines: string[],
    geometry: LogViewportGeometry,
): ViewportModel {
    return applyLogViewportIntent(model, logLines, geometry, {
        kind: 'scrollbar',
        lineCount: logLines.length,
        height: geometry.height,
        pointerRow,
        dragOffset,
    });
}
