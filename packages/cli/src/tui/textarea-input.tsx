/**
 * TextAreaInput — single input surface for both single-line and multiline editor modes.
 * Cursor state is owned by the parent editor so completions and editing share one source of truth.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DOMElement } from 'ink';
import { Box, Text, useCursor, useInput } from 'ink';
import chalk from 'chalk';
import { getTheme, themeColor, createThemedStyles } from './theme.js';
import { buildWrappedEditorLayout, getAbsolutePosition, PROMPT_TEXT } from './editor-layout.js';
import {
    clampOffset,
    deleteBackwardAtOffset,
    insertTextAtOffset,
    lineColumnToOffset,
    moveCursorHorizontal,
    moveCursorVertical,
    offsetToLineColumn,
} from './editor-model.js';
import { sanitizeMultiLineTerminalInput } from './terminal-input.js';

/** 布局计算时最多使用的字符数，避免超长文导致卡顿/崩溃 */
const MAX_VALUE_LENGTH_FOR_LAYOUT = 12000;

export interface TextAreaInputProps {
    value: string;
    onChange: (value: string) => void;
    cursorOffset: number;
    onCursorChange?: (offset: number) => void;
    onSubmit?: (value: string) => void;
    onOpenExternalEditor?: () => void;
    onInterceptKey?: (input: string, key: {
        upArrow?: boolean;
        downArrow?: boolean;
        leftArrow?: boolean;
        rightArrow?: boolean;
        return?: boolean;
        tab?: boolean;
        home?: boolean;
        end?: boolean;
        escape?: boolean;
        ctrl?: boolean;
        meta?: boolean;
        shift?: boolean;
        delete?: boolean;
        backspace?: boolean;
    }) => boolean;
    onCompletionKey?: (input: string, key: {
        upArrow?: boolean;
        downArrow?: boolean;
        leftArrow?: boolean;
        rightArrow?: boolean;
        return?: boolean;
        tab?: boolean;
        home?: boolean;
        end?: boolean;
        escape?: boolean;
        ctrl?: boolean;
        meta?: boolean;
        shift?: boolean;
        delete?: boolean;
        backspace?: boolean;
    }) => boolean;
    completionOpen?: boolean;
    width: number;
    maxHeight: number;
    placeholder?: string;
    isActive?: boolean;
}

export function TextAreaInput({
    value,
    onChange,
    cursorOffset,
    onCursorChange,
    onSubmit,
    onOpenExternalEditor,
    onInterceptKey,
    onCompletionKey,
    completionOpen = false,
    width,
    maxHeight,
    placeholder = 'Type a message...',
    isActive = true,
}: TextAreaInputProps): React.JSX.Element {
    const theme = getTheme();
    const { setCursorPosition } = useCursor();
    const [preferredColumn, setPreferredColumn] = useState<number | undefined>(undefined);

    const cursorRowRef = useRef<DOMElement>(null);
    const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

    // Anchor the terminal cursor to the actual rendered input row instead of
    // the outer container. This avoids the fragile border/padding offsets that
    // previously broke IME candidate placement after resize.
    useLayoutEffect(() => {
        if (!cursorRowRef.current) return;
        try {
            const pos = getAbsolutePosition(cursorRowRef.current);
            setAnchor((prev) => {
                if (prev?.x === pos.x && prev?.y === pos.y) return prev;
                return pos;
            });
        } catch {
            // ignore
        }
    });

    const lines = useMemo(() => value.split('\n'), [value]);
    const safeCursorOffset = clampOffset(value, cursorOffset);
    const cursor = useMemo(() => offsetToLineColumn(value, safeCursorOffset), [safeCursorOffset, value]);
    const wrappedLayout = useMemo(() => {
        try {
            const safeLen = Math.min(value.length, MAX_VALUE_LENGTH_FOR_LAYOUT);
            const safeValue = safeLen < value.length ? value.slice(0, safeLen) : value;
            const safeOffset = Math.min(safeCursorOffset, safeValue.length);
            return buildWrappedEditorLayout(safeValue, safeOffset, width, maxHeight);
        } catch {
            return buildWrappedEditorLayout('', 0, width, maxHeight);
        }
    }, [maxHeight, safeCursorOffset, value, width]);
    const visibleRows = useMemo(
        () =>
            wrappedLayout.rows.slice(
                wrappedLayout.cursor.visibleStartRow,
                wrappedLayout.cursor.visibleStartRow + Math.max(1, maxHeight),
            ),
        [maxHeight, wrappedLayout],
    );
    const cursorVisibleRowIndex = Math.max(0, wrappedLayout.cursor.absoluteRow - wrappedLayout.cursor.visibleStartRow);

    useEffect(() => {
        if (!isActive) {
            try {
                process.stdout.write('\x1b[0 q');
            } catch {
                // ignore
            }
            return;
        }

        try {
            process.stdout.write('\x1b[5 q');
        } catch {
            // ignore
        }

        return () => {
            try {
                process.stdout.write('\x1b[0 q');
            } catch {
                // ignore
            }
        };
    }, [isActive]);

    try {
        if (anchor && isActive) {
            setCursorPosition({
                x: anchor.x + wrappedLayout.cursor.x,
                y: anchor.y,
            });
        } else {
            setCursorPosition(undefined);
        }
    } catch {
        // ignore
    }

    function commit(nextValue: string, nextOffset: number): void {
        onChange(nextValue);
        onCursorChange?.(clampOffset(nextValue, nextOffset));
    }

    function submitDraft(nextValue: string): void {
        const trimmed = nextValue.trim();
        if (!trimmed || !onSubmit) {
            return;
        }

        onSubmit(trimmed);
        onChange('');
        setPreferredColumn(undefined);
        onCursorChange?.(0);
    }

    useInput(
        (input, key) => {
            try {
                if (!isActive) return;
                if (typeof value !== 'string' || typeof cursorOffset !== 'number') return;
                if (onInterceptKey?.(input, key)) {
                    return;
                }
                if (completionOpen && onCompletionKey?.(input, key)) {
                    return;
                }

                if (key.ctrl && input === 'e') {
                    onOpenExternalEditor?.();
                    return;
                }

                const sendShortcut = key.return || (key.ctrl && input === 's');
                if (sendShortcut) {
                    if (value.endsWith('\\')) {
                        const nextValue = `${value.slice(0, -1)}\n`;
                        commit(nextValue, nextValue.length);
                        setPreferredColumn(undefined);
                    } else {
                        submitDraft(value);
                    }
                    return;
                }

                if (key.backspace || key.delete) {
                    const deleted = deleteBackwardAtOffset(value, safeCursorOffset);
                    commit(deleted.value, deleted.offset);
                    setPreferredColumn(undefined);
                    return;
                }

                if (key.upArrow) {
                    if (maxHeight <= 1) {
                        return;
                    }

                    const moved = moveCursorVertical(value, safeCursorOffset, -1, preferredColumn);
                    setPreferredColumn(moved.preferredColumn);
                    onCursorChange?.(moved.offset);
                    return;
                }

                if (key.downArrow) {
                    if (maxHeight <= 1) {
                        return;
                    }

                    const moved = moveCursorVertical(value, safeCursorOffset, 1, preferredColumn);
                    setPreferredColumn(moved.preferredColumn);
                    onCursorChange?.(moved.offset);
                    return;
                }

                if (key.leftArrow) {
                    const next = moveCursorHorizontal(value, safeCursorOffset, -1);
                    setPreferredColumn(undefined);
                    onCursorChange?.(next);
                    return;
                }

                if (key.rightArrow) {
                    const next = moveCursorHorizontal(value, safeCursorOffset, 1);
                    setPreferredColumn(undefined);
                    onCursorChange?.(next);
                    return;
                }

                if (key.home) {
                    const next = lineColumnToOffset(value, cursor.line, 0);
                    setPreferredColumn(undefined);
                    onCursorChange?.(next);
                    return;
                }

                if (key.end) {
                    const next = lineColumnToOffset(value, cursor.line, lines[cursor.line]?.length ?? 0);
                    setPreferredColumn(undefined);
                    onCursorChange?.(next);
                    return;
                }

                if (key.ctrl || key.meta || key.tab) return;
                if (input.startsWith('[<') || (input.startsWith('[M') && input.length >= 5)) return;
                if (input.startsWith('\u001b') || (input.length === 1 && input.charCodeAt(0) < 32)) return;

                const normalized = sanitizeMultiLineTerminalInput(input);
                if (!normalized) return;
                if (normalized.length > 20000) return;

                const inserted = insertTextAtOffset(value, safeCursorOffset, normalized);
                commit(inserted.value, inserted.offset);
                setPreferredColumn(undefined);
            } catch {
                // IME/拼音路径异常时不更新，避免闪退
            }
        },
        { isActive },
    );

    const prompt = PROMPT_TEXT;
    const showPlaceholder = value.length === 0 && !isActive && placeholder.length > 0;

    let body: React.ReactNode;
    try {
        if (showPlaceholder) {
            body = (
                <Box ref={cursorRowRef}>
                    <Text>{prompt}{createThemedStyles(theme).muted(placeholder)}</Text>
                </Box>
            );
        } else if (value.length === 0) {
            body = (
                <Box ref={cursorRowRef}>
                    <Text>{prompt}</Text>
                </Box>
            );
        } else {
            body = visibleRows.map((row, rowIndex) => {
                return (
                    <Box
                        key={`${row.lineIndex}-${row.startIndex}`}
                        ref={rowIndex === cursorVisibleRowIndex ? cursorRowRef : undefined}
                    >
                        <Text color={themeColor(theme, theme.textMuted)}>{row.prefix}</Text>
                        <Text>{row.text}</Text>
                    </Box>
                );
            });
        }
    } catch {
        body = (
            <Box ref={cursorRowRef}>
                <Text>{prompt}{value || createThemedStyles(theme).muted(placeholder)}</Text>
            </Box>
        );
    }

    return <Box flexDirection="column" width={width}>{body}</Box>;
}
