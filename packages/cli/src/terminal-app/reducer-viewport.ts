import type { TerminalAppState } from '../terminal-core/app-state.js';
import { getCompleteOverlayVisibleRows } from '../terminal-core/overlay-geometry.js';
import { createRustLayoutHitTestQuery } from '../terminal-core/rust-layout-hit-test-query.js';
import { getProjectedLogViewportHeight, getProjectedTranscriptViewportHeight, getTranscriptHeight } from '../terminal-core/runtime-bridge.js';
import { rustTui } from '../terminal-core/rust-tui.js';
import {
    moveLogViewportToBottom,
    moveLogViewportToTop,
    pageLogViewportModel,
    scrollLogViewportModel,
    setLogViewportFromScrollbar,
    setLogViewportTopLine,
    syncLogViewportModel,
} from './log-viewport-model.js';

const PAGE_SCROLL_RATIO = 0.85;

function getViewportGeometry(state: TerminalAppState): { height: number; contentWidth: number } {
    const layout = createRustLayoutHitTestQuery(state).computeBaseLayout();
    return {
        height: Math.max(1, layout?.messages?.height ?? getTranscriptHeight(state)),
        contentWidth: Math.max(1, (layout?.messages?.width ?? Math.max(3, state.size.width - 2)) - 2),
    };
}

export function getChatViewportHeight(state: TerminalAppState): number {
    return getViewportGeometry(state).height;
}

export function getCompleteOverlayVisibleRowsForState(state: TerminalAppState, itemCount: number): number {
    if (itemCount <= 0) {
        return 0;
    }
    const layout = createRustLayoutHitTestQuery(state, {
        overlayItemCount: itemCount,
    }).computeOverlayLayout();
    return getCompleteOverlayVisibleRows(layout?.overlay?.height ?? 0, itemCount);
}

function projectChatViewport(state: TerminalAppState): TerminalAppState['viewport'] {
    const rustViewport = rustTui.queryMessageViewport();
    return {
        ...state.viewport,
        scrollOffset: rustViewport.scrollOffset,
        isFollowingBottom: rustViewport.isFollowingBottom,
        viewportHeight: getChatViewportHeight(state),
    };
}

export function withChatViewportProjection(state: TerminalAppState, clearSelection = false): TerminalAppState {
    const viewport = projectChatViewport(state);
    return {
        ...state,
        viewport: clearSelection ? { ...viewport, selectedRange: null } : viewport,
    };
}

export function syncTranscriptViewport(next: TerminalAppState): TerminalAppState {
    return withChatViewportProjection(next);
}

export function withLogViewportProjection(state: TerminalAppState, clearSelection = false): TerminalAppState {
    const geometry = getViewportGeometry(state);
    const logViewport = syncLogViewportModel(state.logViewport, state.logLines, geometry);
    return {
        ...state,
        logViewport: clearSelection ? { ...logViewport, selectedRange: null } : logViewport,
    };
}

export function syncLogViewport(next: TerminalAppState): TerminalAppState {
    return withLogViewportProjection(next);
}

export function applyChatViewportIntent(
    state: TerminalAppState,
    intent: import('../terminal-core/rust-tui.js').MessageViewportIntent,
    clearSelection = true,
): TerminalAppState {
    rustTui.applyMessageViewportIntent(intent);
    return withChatViewportProjection(state, clearSelection);
}

export function scrollChatViewport(state: TerminalAppState, delta: number): TerminalAppState {
    return applyChatViewportIntent(state, { kind: 'delta', delta });
}

export function pageChatViewport(state: TerminalAppState, direction: 'up' | 'down'): TerminalAppState {
    const projectedHeight = getProjectedTranscriptViewportHeight(state, getChatViewportHeight(state));
    const pageSize = Math.max(1, Math.floor(projectedHeight * PAGE_SCROLL_RATIO));
    return applyChatViewportIntent(state, { kind: 'page', direction, pageSize });
}

export function moveChatViewportToTop(state: TerminalAppState): TerminalAppState {
    return applyChatViewportIntent(state, { kind: 'home' });
}

export function moveChatViewportToBottom(state: TerminalAppState): TerminalAppState {
    return applyChatViewportIntent(state, { kind: 'end' });
}

export function setChatViewportTopLine(state: TerminalAppState, topLine: number): TerminalAppState {
    return applyChatViewportIntent(state, {
        kind: 'set-top-line',
        topLine: Math.max(0, Math.trunc(topLine)),
    });
}

export function scrollLogViewport(state: TerminalAppState, delta: number): TerminalAppState {
    return {
        ...state,
        logViewport: scrollLogViewportModel(state.logViewport, delta, state.logLines, getViewportGeometry(state)),
    };
}

export function pageLogViewport(state: TerminalAppState, direction: 'up' | 'down'): TerminalAppState {
    const geometry = getViewportGeometry(state);
    const projectedHeight = getProjectedLogViewportHeight(state, geometry.height);
    return {
        ...state,
        logViewport: pageLogViewportModel(state.logViewport, direction, state.logLines, {
            ...geometry,
            height: projectedHeight,
        }),
    };
}

export function moveLogViewportHome(state: TerminalAppState): TerminalAppState {
    return {
        ...state,
        logViewport: moveLogViewportToTop(state.logViewport, state.logLines, getViewportGeometry(state)),
    };
}

export function moveLogViewportEnd(state: TerminalAppState): TerminalAppState {
    return {
        ...state,
        logViewport: moveLogViewportToBottom(state.logViewport, state.logLines, getViewportGeometry(state)),
    };
}

export function setLogViewportTopLineIntent(state: TerminalAppState, topLine: number): TerminalAppState {
    return {
        ...state,
        logViewport: setLogViewportTopLine(state.logViewport, topLine, state.logLines, getViewportGeometry(state)),
    };
}

export function applyLogViewportScrollbar(state: TerminalAppState, pointerRow: number, dragOffset = 0): TerminalAppState {
    return {
        ...state,
        logViewport: setLogViewportFromScrollbar(
            state.logViewport,
            pointerRow,
            dragOffset,
            state.logLines,
            getViewportGeometry(state),
        ),
    };
}
