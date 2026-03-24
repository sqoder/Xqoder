import { rustTui } from './rust-tui.js';
import { getRendererMode } from './rust-renderer.js';

export interface ScrollbarModel {
    visible: boolean;
    thumbTop: number;
    thumbHeight: number;
    trackHeight: number;
}

function toSafeNonNegativeInt(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function getViewportVisibleCapacity(height: number): number {
    return Math.max(1, toSafeNonNegativeInt(height));
}

export function resolveTranscriptTopLineFromJump(
    lineCount: number,
    height: number,
    targetLine: number,
    anchorNumerator: number = 1,
    anchorDenominator: number = 3,
): number {
    const safeLineCount = toSafeNonNegativeInt(lineCount);
    const safeHeight = getViewportVisibleCapacity(height);
    const safeTargetLine = toSafeNonNegativeInt(targetLine);
    const safeAnchorNumerator = toSafeNonNegativeInt(anchorNumerator);
    const safeAnchorDenominator = Math.max(1, toSafeNonNegativeInt(anchorDenominator));
    const rustScrollOffset = rustTui.resolveJumpTopLine(
        safeLineCount,
        safeHeight,
        safeTargetLine,
        safeAnchorNumerator,
        safeAnchorDenominator,
    );
    if (typeof rustScrollOffset === 'number') {
        return toSafeNonNegativeInt(rustScrollOffset);
    }
    if (getRendererMode() === 'rust') {
        throw new Error('[XQoder] Rust renderer required (mode="rust") but resolveJumpTopLine returned null.');
    }
    return safeTargetLine;
}

export function buildTranscriptScrollbarModel(lineCount: number, height: number, scrollOffset: number): ScrollbarModel {
    const trackHeight = Math.max(1, height);
    const visibleCapacity = getViewportVisibleCapacity(height);
    const clampedScrollOffset = toSafeNonNegativeInt(scrollOffset);

    const rustThumb = rustTui.computeScrollbar(lineCount, visibleCapacity, clampedScrollOffset, trackHeight);
    if (rustThumb) {
        return {
            visible: rustThumb.visible,
            thumbTop: rustThumb.thumbTop,
            thumbHeight: rustThumb.thumbHeight,
            trackHeight: rustThumb.trackHeight,
        };
    }

    if (getRendererMode() === 'rust') {
        throw new Error('[XQoder] Rust renderer required (mode="rust") but computeScrollbar returned null.');
    }

    return {
        visible: false,
        thumbTop: 0,
        thumbHeight: trackHeight,
        trackHeight,
    };
}

export function resolveTranscriptTopLineFromScrollbar(
    lineCount: number,
    height: number,
    pointerRow: number,
    dragOffset: number = 0,
): number {
    const rustScrollOffset = rustTui.resolveTopLine(lineCount, height, pointerRow, dragOffset);
    if (typeof rustScrollOffset === 'number') {
        return toSafeNonNegativeInt(rustScrollOffset);
    }
    if (getRendererMode() === 'rust') {
        throw new Error('[XQoder] Rust renderer required (mode="rust") but resolveTopLine returned null.');
    }
    return 0;
}
