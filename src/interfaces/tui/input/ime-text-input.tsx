/**
 * ImeTextInput — IME-friendly alternative to ink-text-input.
 *
 * Cursor: Only hides the terminal's actual cursor (setCursorPosition(undefined)) without moving its position;
 * The cursor is self-drawn via inverse styling (chalk.inverse) to avoid terminal crashes from IME/long text
 * (referenced from OpenCode/OpenTUI patterns).
 */

import React, { useEffect, useState } from 'react';
import { Box, Text, useCursor, useInput } from 'ink';
import chalk from 'chalk';
import { sanitizeSingleLineTerminalInput } from '../terminal-input.js';

export interface ImeTextInputProps {
    /** Controlled value */
    value: string;
    /** Change callback */
    onChange: (value: string) => void;
    /** Submit callback */
    onSubmit?: (value: string) => void;
    /** Placeholder text */
    placeholder?: string;
    /** Focused status */
    focus?: boolean;
    /** Character mask */
    mask?: string;
    /** Show cursor */
    showCursor?: boolean;
    /** Highlight pasted text */
    highlightPastedText?: boolean;
}

export function ImeTextInput({
    value: originalValue,
    placeholder = '',
    focus = true,
    mask,
    highlightPastedText = false,
    showCursor = true,
    onChange,
    onSubmit,
}: ImeTextInputProps): React.JSX.Element {
    const [state, setState] = useState({
        cursorOffset: (originalValue || '').length,
        cursorWidth: 0,
    });

    const { setCursorPosition } = useCursor();
    const { cursorOffset, cursorWidth } = state;

    useEffect(() => {
        setState((previousState) => {
            if (!focus || !showCursor) {
                return previousState;
            }

            const newValue = originalValue || '';
            if (previousState.cursorOffset > newValue.length) {
                return {
                    cursorOffset: newValue.length,
                    cursorWidth: 0,
                };
            }

            return previousState;
        });
    }, [originalValue, focus, showCursor]);

    try {
        setCursorPosition(undefined);
    } catch {
        // ignore
    }

    const cursorActualWidth = highlightPastedText ? cursorWidth : 0;
    const value = typeof originalValue === 'string'
        ? (mask ? mask.repeat(originalValue.length) : originalValue)
        : '';

    let renderedValue = value;
    let renderedPlaceholder = placeholder ? chalk.grey(placeholder) : undefined;

    try {
        if (showCursor && focus) {
            renderedPlaceholder =
                placeholder.length > 0
                    ? chalk.inverse(placeholder[0]) + chalk.grey(placeholder.slice(1))
                    : chalk.inverse(' ');

            renderedValue = value.length > 0 ? '' : chalk.inverse(' ');
            const safeCursor = Math.max(0, Math.min(cursorOffset, value.length));
            const low = Math.max(0, safeCursor - cursorActualWidth);
            const high = safeCursor;

            let i = 0;
            for (const char of value) {
                try {
                    renderedValue += i >= low && i <= high ? chalk.inverse(char) : char;
                } catch {
                    renderedValue += char;
                }
                i++;
            }
            if (value.length > 0 && safeCursor >= value.length) {
                renderedValue += chalk.inverse(' ');
            }
        }
    } catch {
        renderedValue = value;
    }

    useInput(
        (input, key) => {
            try {
                if (
                    key.upArrow ||
                    key.downArrow ||
                    (key.ctrl && input === 'c') ||
                    key.tab ||
                    (key.shift && key.tab)
                ) {
                    return;
                }

                if (key.return) {
                    if (onSubmit) {
                        onSubmit(typeof originalValue === 'string' ? originalValue : String(originalValue ?? ''));
                    }
                    return;
                }

                const normalizedInput = sanitizeSingleLineTerminalInput(input);
                const str = typeof originalValue === 'string' ? originalValue : String(originalValue ?? '');
                const safeOffset = Math.max(0, Math.min(cursorOffset, str.length));

                let nextCursorOffset = cursorOffset;
                let nextValue = str;
                let nextCursorWidth = 0;

                if (key.leftArrow) {
                    if (showCursor) nextCursorOffset = Math.max(0, safeOffset - 1);
                } else if (key.rightArrow) {
                    if (showCursor) nextCursorOffset = Math.min(str.length, safeOffset + 1);
                } else if (key.backspace || key.delete) {
                    if (safeOffset > 0) {
                        nextValue = str.slice(0, safeOffset - 1) + str.slice(safeOffset);
                        nextCursorOffset = safeOffset - 1;
                    }
                } else {
                    if (normalizedInput.length === 0) return;

                    nextValue = str.slice(0, safeOffset) + normalizedInput + str.slice(safeOffset);
                    nextCursorOffset = safeOffset + normalizedInput.length;
                    if (normalizedInput.length > 1) nextCursorWidth = normalizedInput.length;
                }

                nextCursorOffset = Math.max(0, Math.min(nextCursorOffset, nextValue.length));

                setState({ cursorOffset: nextCursorOffset, cursorWidth: nextCursorWidth });
                if (nextValue !== str) onChange(nextValue);
            } catch {
                // Don't update state on IME path exceptions to avoid crashes
            }
        },
        { isActive: focus },
    );

    return (
        <Box>
            <Text>
                {placeholder
                    ? value.length > 0
                        ? renderedValue
                        : renderedPlaceholder
                    : renderedValue}
            </Text>
        </Box>
    );
}
