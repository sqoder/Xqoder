import {
    buildTranscriptSelectionText,
    getDisplayWidth,
    hasSelectionDragExceededThreshold,
    moveMessageViewportToBottom,
    normalizeSelectionRange,
    pageMessageViewport,
    resolveTopLineFromScrollbar,
    scrollMessageViewport,
    type MessageViewportState,
    type TranscriptSelectionPoint,
    type TranscriptSelectionRange,
} from './message-viewport-state.js';
import { isScrollbarHit, isScrollbarThumbHit, pointFromTranscript, type ParsedMouseInput } from './message-viewport-interaction.js';

export interface ViewportControllerContext {
    state: MessageViewportState;
    transcriptLines: string[];
    height: number;
    contentWidth: number;
    visibleLines: string[];
    topLine: number;
    maxTopLine: number;
    mouseScrollStep: number;
    visibleLineCount: number;
    scrollbarMetrics: { visible: boolean; thumbTop: number; thumbHeight: number };
    scrollbarWidth: number;
    scrollbarGrabSlop?: number;
    scrollbarAnchor: { x: number; y: number } | null;
    transcriptAnchor: { x: number; y: number } | null;
    draggingScrollbar: boolean;
    scrollbarDragOffset: number;
    draggingSelection: boolean;
    selectionStart: TranscriptSelectionPoint | null;
    selectionRange: TranscriptSelectionRange | null;
    selectionDragThreshold?: number;
}

export interface ViewportControllerResult {
    nextState: MessageViewportState;
    draggingScrollbar?: boolean;
    scrollbarDragOffset?: number;
    draggingSelection?: boolean;
    selectionStart?: TranscriptSelectionPoint | null;
    selectionRange?: TranscriptSelectionRange | null;
    copiedText?: string;
    handled: boolean;
}

export function handleViewportMouseEvent(
    event: ParsedMouseInput,
    context: ViewportControllerContext,
): ViewportControllerResult {
    const dragThreshold = context.selectionDragThreshold ?? 1;
    const scrollbarGrabSlop = context.scrollbarGrabSlop ?? 0;

    const resolveLineMaxColumn = (point: TranscriptSelectionPoint | null): number => {
        if (!point) {
            return Math.max(0, context.contentWidth - 1);
        }

        const visibleIndex = point.line - context.topLine;
        const line = context.visibleLines[visibleIndex] ?? '';
        return Math.max(0, Math.min(context.contentWidth - 1, getDisplayWidth(line)));
    };

    if (event.code === 64) {
        return {
            handled: true,
            nextState: scrollMessageViewport(context.state, -context.mouseScrollStep, context.transcriptLines.length, context.height),
        };
    }

    if (event.code === 65) {
        return {
            handled: true,
            nextState: scrollMessageViewport(context.state, context.mouseScrollStep, context.transcriptLines.length, context.height),
        };
    }

    if (event.action === 'release') {
        const releasePoint = context.transcriptAnchor
            ? pointFromTranscript(event.x, event.y, {
                anchor: context.transcriptAnchor,
                topLine: context.topLine,
                visibleLineCount: context.visibleLineCount,
                maxColumn: Math.max(0, context.contentWidth - 1),
                clampOutside: true,
            })
            : null;
        const normalizedReleasePoint = releasePoint
            ? { ...releasePoint, column: Math.min(releasePoint.column, resolveLineMaxColumn(releasePoint)) }
            : null;
        const nextRange = context.draggingSelection && context.selectionStart && normalizedReleasePoint
            ? (hasSelectionDragExceededThreshold(context.selectionStart, normalizedReleasePoint, dragThreshold)
                ? normalizeSelectionRange(context.selectionStart, normalizedReleasePoint)
                : null)
            : context.selectionRange;
        const copiedText = context.draggingSelection && context.selectionStart && nextRange
            ? buildTranscriptSelectionText(context.transcriptLines, nextRange.start, nextRange.end)
            : undefined;

        return {
            handled: true,
            nextState: {
                ...context.state,
                selectionRange: nextRange ?? context.state.selectionRange,
            },
            draggingScrollbar: false,
            draggingSelection: false,
            selectionRange: nextRange ?? context.selectionRange,
            copiedText: copiedText && copiedText.length > 0 ? copiedText : undefined,
        };
    }

    if ((event.code === 0 || event.code === 32)
        && context.scrollbarAnchor
        && context.scrollbarMetrics.visible
        && isScrollbarHit(event.x, event.y, {
            anchor: context.scrollbarAnchor,
            width: context.scrollbarWidth,
            height: context.height,
        })) {
        const relativeRow = event.y - 1 - context.scrollbarAnchor.y;
        if (isScrollbarThumbHit(event.x, event.y, {
            anchor: context.scrollbarAnchor,
            width: context.scrollbarWidth,
            height: context.height,
        }, context.scrollbarMetrics.thumbTop, context.scrollbarMetrics.thumbHeight, scrollbarGrabSlop)) {
            const dragOffset = Math.max(0, relativeRow - context.scrollbarMetrics.thumbTop);
            const nextTopLine = resolveTopLineFromScrollbar(
                context.transcriptLines.length,
                context.height,
                relativeRow,
                dragOffset,
            );
            return {
                handled: true,
                nextState: nextTopLine >= context.maxTopLine
                    ? moveMessageViewportToBottom(context.state, context.transcriptLines.length, context.height)
                    : { ...context.state, autoFollow: false, topLine: nextTopLine },
                draggingScrollbar: true,
                scrollbarDragOffset: dragOffset,
                draggingSelection: false,
            };
        }

        return {
            handled: true,
            nextState: pageMessageViewport(
                context.state,
                relativeRow < context.scrollbarMetrics.thumbTop ? 'up' : 'down',
                context.transcriptLines.length,
                context.height,
            ),
            draggingSelection: false,
        };
    }

    if (context.draggingScrollbar) {
        const relativeRow = context.scrollbarAnchor ? event.y - 1 - context.scrollbarAnchor.y : 0;
        const nextTopLine = resolveTopLineFromScrollbar(
            context.transcriptLines.length,
            context.height,
            relativeRow,
            context.scrollbarDragOffset,
        );

        return {
            handled: true,
            nextState: nextTopLine >= context.maxTopLine
                ? moveMessageViewportToBottom(context.state, context.transcriptLines.length, context.height)
                : { ...context.state, autoFollow: false, topLine: nextTopLine },
            draggingScrollbar: true,
        };
    }

    const point = context.transcriptAnchor
        ? pointFromTranscript(event.x, event.y, {
            anchor: context.transcriptAnchor,
            topLine: context.topLine,
            visibleLineCount: context.visibleLineCount,
            maxColumn: Math.max(0, context.contentWidth - 1),
            clampOutside: context.draggingSelection,
        })
        : null;
    if (!point) {
        return { handled: false, nextState: context.state };
    }
    const clampedPoint = { ...point, column: Math.min(point.column, resolveLineMaxColumn(point)) };

    if (event.code === 0) {
        const nextRange = { start: clampedPoint, end: clampedPoint };
        return {
            handled: true,
            nextState: { ...context.state, selectionRange: nextRange },
            draggingSelection: true,
            selectionStart: clampedPoint,
            selectionRange: nextRange,
        };
    }

    if (context.draggingSelection && context.selectionStart && event.code === 32) {
        if (!hasSelectionDragExceededThreshold(context.selectionStart, clampedPoint, dragThreshold)) {
            return {
                handled: true,
                nextState: context.state,
                selectionRange: context.selectionRange,
            };
        }

        const nextRange = normalizeSelectionRange(context.selectionStart, clampedPoint);
        return {
            handled: true,
            nextState: { ...context.state, selectionRange: nextRange },
            selectionRange: nextRange,
        };
    }

    return { handled: false, nextState: context.state };
}
