import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DOMElement } from 'ink';
import { Box, Text, useInput, useStdin } from 'ink';
import type { TuiMouseMode } from '@xqoder/shared';
import { getAbsolutePosition } from './editor-layout.js';
import { MessageScrollbar, MESSAGE_SCROLLBAR_WIDTH } from './message-scrollbar.js';
import { copyTranscriptSelectionToClipboard } from './message-viewport-clipboard.js';
import { handleViewportMouseEvent } from './message-viewport-controller.js';
import { parseMouseInput } from './message-viewport-interaction.js';
import {
    buildScrollbarMetrics,
    buildSelectionLineSegments,
    createInitialMessageViewportState,
    getTranscriptMaxTopLine,
    moveMessageViewportByHalfPage,
    moveMessageViewportToBottom,
    moveMessageViewportToTop,
    scrollMessageViewport,
    syncMessageViewport,
    type MessageViewportState,
    type TranscriptSelectionPoint,
    type TranscriptSelectionRange,
} from './message-viewport-state.js';
import { buildTranscriptLines, sliceTranscriptLines } from './transcript-viewport.js';
import type { ChatMessage } from './message-types.js';

export interface MessageListProps {
    messages: ChatMessage[];
    width: number;
    height: number;
    isActive?: boolean;
    mouseMode?: TuiMouseMode;
    mouseScrollStep?: number;
    arrowScrollEnabled?: boolean;
    onAutoFollowChange?: (autoFollow: boolean) => void;
    onSelectionCopied?: (success: boolean) => void;
}

export function shouldEnableMouseCapture(mouseMode: TuiMouseMode): boolean {
    return mouseMode === 'app';
}

export function buildEmptyStateLines(width: number): string[] {
    const contentWidth = Math.max(24, width - 4);
    const lines = [
        'XQoder',
        'Ask for code changes, repo explanations, or terminal actions.',
        'Try /help, /session list, /diff, /timeline, or start typing below.',
    ];

    return lines.map((line) => line.length > contentWidth ? `${line.slice(0, contentWidth - 3)}...` : line);
}

export const MessageList = React.memo(function MessageList({
    messages,
    width,
    height,
    isActive = true,
    mouseMode = 'terminal',
    mouseScrollStep = 3,
    arrowScrollEnabled = false,
    onAutoFollowChange,
    onSelectionCopied,
}: MessageListProps): React.JSX.Element {
    const { internal_eventEmitter } = useStdin();
    const [viewportState, setViewportState] = useState<MessageViewportState>(() => createInitialMessageViewportState());
    const [transcriptLines, setTranscriptLines] = useState<string[]>(() => buildTranscriptLines(messages, width));
    const previousLineCount = useRef(0);
    const previousWidth = useRef(width);
    const transcriptContentRef = useRef<DOMElement>(null);
    const [transcriptContentAnchor, setTranscriptContentAnchor] = useState<{ x: number; y: number } | null>(null);
    const scrollbarRef = useRef<DOMElement>(null);
    const [scrollbarAnchor, setScrollbarAnchor] = useState<{ x: number; y: number } | null>(null);
    const draggingScrollbar = useRef(false);
    const scrollbarDragOffset = useRef(0);
    const draggingSelection = useRef(false);
    const selectionStart = useRef<TranscriptSelectionPoint | null>(null);
    const selectionRangeRef = useRef<TranscriptSelectionRange | null>(null);
    const viewportStateRef = useRef(viewportState);
    const transcriptLinesRef = useRef(transcriptLines);
    const onSelectionCopiedRef = useRef(onSelectionCopied);
    const { autoFollow, topLine, selectionRange } = viewportState;

    useEffect(() => {
        onAutoFollowChange?.(autoFollow);
    }, [autoFollow, onAutoFollowChange]);

    useEffect(() => {
        selectionRangeRef.current = selectionRange;
    }, [selectionRange]);

    useEffect(() => {
        viewportStateRef.current = viewportState;
    }, [viewportState]);

    useEffect(() => {
        transcriptLinesRef.current = transcriptLines;
    }, [transcriptLines]);

    useEffect(() => {
        onSelectionCopiedRef.current = onSelectionCopied;
    }, [onSelectionCopied]);

    useEffect(() => {
        const widthChanged = previousWidth.current !== width;
        previousWidth.current = width;

        if (autoFollow || widthChanged || (transcriptLines.length === 0 && messages.length > 0)) {
            setTranscriptLines(buildTranscriptLines(messages, width));
        }
    }, [autoFollow, messages, transcriptLines.length, width]);

    const scrollbarMetrics = buildScrollbarMetrics(transcriptLines.length, height, topLine);
    const slice = sliceTranscriptLines(transcriptLines, topLine, height);
    const contentWidth = Math.max(1, width - 2);

    useLayoutEffect(() => {
        if (transcriptContentRef.current) {
            try {
                const pos = getAbsolutePosition(transcriptContentRef.current);
                setTranscriptContentAnchor((previous) => {
                    if (previous?.x === pos.x && previous?.y === pos.y) {
                        return previous;
                    }
                    return pos;
                });
            } catch {
                // ignore layout lookup failures during resize
            }
        }

        if (!scrollbarRef.current) {
            return;
        }

        try {
            const pos = getAbsolutePosition(scrollbarRef.current);
            setScrollbarAnchor((previous) => {
                if (previous?.x === pos.x && previous?.y === pos.y) {
                    return previous;
                }
                return pos;
            });
        } catch {
            // ignore layout lookup failures during resize
        }
    });

    useEffect(() => {
        const nextLineCount = transcriptLines.length;
        setViewportState((previous) => syncMessageViewport(previous, {
            lineCount: nextLineCount,
            previousLineCount: previousLineCount.current,
            height,
        }));
        previousLineCount.current = nextLineCount;
    }, [height, transcriptLines.length]);

    useEffect(() => {
        if (!shouldEnableMouseCapture(mouseMode)) {
            try { process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l'); } catch { /* ignore */ }
            return;
        }

        try { process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h'); } catch { /* ignore */ }

        function applyControllerResult(result: ReturnType<typeof handleViewportMouseEvent>): void {
            if (!result.handled) {
                return;
            }

            draggingScrollbar.current = result.draggingScrollbar ?? draggingScrollbar.current;
            scrollbarDragOffset.current = result.scrollbarDragOffset ?? scrollbarDragOffset.current;
            draggingSelection.current = result.draggingSelection ?? draggingSelection.current;
            selectionStart.current = result.selectionStart ?? selectionStart.current;
            selectionRangeRef.current = result.selectionRange ?? selectionRangeRef.current;
            viewportStateRef.current = result.nextState;
            setViewportState(result.nextState);

            if (result.copiedText !== undefined) {
                const copied = copyTranscriptSelectionToClipboard(result.copiedText);
                onSelectionCopiedRef.current?.(copied);
            }
        }

        function onInput(input: string): void {
            const event = parseMouseInput(input);
            if (!event) {
                return;
            }

            const currentTranscriptLines = transcriptLinesRef.current;
            const currentViewportState = viewportStateRef.current;
            const currentTopLine = currentViewportState.topLine;
            const currentScrollbarMetrics = buildScrollbarMetrics(currentTranscriptLines.length, height, currentTopLine);
            const currentMaxTopLine = getTranscriptMaxTopLine(currentTranscriptLines.length, height);
            const currentSlice = sliceTranscriptLines(currentTranscriptLines, currentTopLine, height);

            const result = handleViewportMouseEvent(event, {
                state: currentViewportState,
                transcriptLines: currentTranscriptLines,
                height,
                contentWidth,
                visibleLines: currentSlice.visible,
                topLine: currentTopLine,
                maxTopLine: currentMaxTopLine,
                mouseScrollStep,
                visibleLineCount: currentSlice.visible.length,
                scrollbarMetrics: {
                    visible: currentScrollbarMetrics.visible,
                    thumbTop: currentScrollbarMetrics.thumbTop,
                    thumbHeight: currentScrollbarMetrics.thumbHeight,
                },
                scrollbarWidth: MESSAGE_SCROLLBAR_WIDTH,
                scrollbarGrabSlop: 2,
                scrollbarAnchor,
                transcriptAnchor: transcriptContentAnchor,
                draggingScrollbar: draggingScrollbar.current,
                scrollbarDragOffset: scrollbarDragOffset.current,
                draggingSelection: draggingSelection.current,
                selectionStart: selectionStart.current,
                selectionRange: selectionRangeRef.current,
                selectionDragThreshold: 2,
            });

            applyControllerResult(result);
        }

        internal_eventEmitter.on('input', onInput);
        return () => {
            draggingScrollbar.current = false;
            try { process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l'); } catch { /* ignore */ }
            internal_eventEmitter.off('input', onInput);
        };
    }, [height, internal_eventEmitter, mouseMode, mouseScrollStep, scrollbarAnchor, transcriptContentAnchor]);

    useInput((input, key) => {
        const pageUp = key.pageUp || (key.ctrl && input === 'u');
        const pageDown = key.pageDown || (key.ctrl && input === 'd');

        if (pageUp) {
            setViewportState((previous) => moveMessageViewportByHalfPage(previous, 'up', transcriptLines.length, height));
            return;
        }

        if (pageDown) {
            setViewportState((previous) => moveMessageViewportByHalfPage(previous, 'down', transcriptLines.length, height));
            return;
        }

        if (key.home) {
            setViewportState((previous) => moveMessageViewportToTop(previous));
            return;
        }

        if (key.end) {
            setViewportState((previous) => moveMessageViewportToBottom(previous, transcriptLines.length, height));
            return;
        }

        if (arrowScrollEnabled && key.upArrow) {
            setViewportState((previous) => scrollMessageViewport(previous, -1, transcriptLines.length, height));
            return;
        }

        if (arrowScrollEnabled && key.downArrow) {
            setViewportState((previous) => scrollMessageViewport(previous, 1, transcriptLines.length, height));
        }
    }, { isActive });

    if (transcriptLines.length === 0) {
        const emptyStateLines = buildEmptyStateLines(width);
        return (
            <Box height={height} justifyContent="flex-start" paddingTop={1}>
                <Box flexDirection="column">
                    {emptyStateLines.map((line, index) => (
                        <Text key={`empty-${index}`}>{line}</Text>
                    ))}
                </Box>
            </Box>
        );
    }

    return (
        <Box flexDirection="row" width={width} height={height} overflow="hidden">
            <Box flexDirection="column" width={contentWidth} height={height} overflow="hidden">
                <Box ref={transcriptContentRef} flexDirection="column" flexGrow={1} overflow="hidden">
                    {slice.visible.map((line, index) => {
                        const absoluteLine = topLine + index;
                        const segments = buildSelectionLineSegments(line, absoluteLine, selectionRange);

                        return (
                            <Text
                                key={`${topLine}-${index}`}
                            >
                                {segments
                                    ? (
                                        <>
                                            {segments.before}
                                            <Text backgroundColor="#b7d1ef" color="#0b1320">{segments.selected || ' '}</Text>
                                            {segments.after}
                                        </>
                                    )
                                    : (line || ' ')}
                            </Text>
                        );
                    })}
                </Box>
            </Box>

            <MessageScrollbar
                metrics={scrollbarMetrics}
                height={height}
                width={MESSAGE_SCROLLBAR_WIDTH}
                scrollbarRef={scrollbarRef}
            />
        </Box>
    );
});

MessageList.displayName = 'MessageList';
