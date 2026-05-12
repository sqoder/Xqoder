// P22b — TextInput: single-line text input with cursor.
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface TextInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit?: (value: string) => void;
    placeholder?: string;
    focus?: boolean;
}

export function TextInput({ value, onChange, onSubmit, placeholder = '', focus = true }: TextInputProps): React.ReactElement {
    const [cursorPos, setCursorPos] = useState(value.length);

    useInput((input, key) => {
        if (!focus) return;

        if (key.return) {
            onSubmit?.(value);
            return;
        }

        if (key.backspace || key.delete) {
            if (cursorPos > 0) {
                const next = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
                onChange(next);
                setCursorPos((p) => Math.max(0, p - 1));
            }
            return;
        }

        if (key.leftArrow) {
            setCursorPos((p) => Math.max(0, p - 1));
            return;
        }

        if (key.rightArrow) {
            setCursorPos((p) => Math.min(value.length, p + 1));
            return;
        }

        if (key.ctrl && input === 'a') {
            setCursorPos(0);
            return;
        }

        if (key.ctrl && input === 'e') {
            setCursorPos(value.length);
            return;
        }

        if (key.ctrl && input === 'k') {
            onChange(value.slice(0, cursorPos));
            return;
        }

        if (key.ctrl && input === 'u') {
            onChange(value.slice(cursorPos));
            setCursorPos(0);
            return;
        }

        if (!key.ctrl && !key.meta && input) {
            const next = value.slice(0, cursorPos) + input + value.slice(cursorPos);
            onChange(next);
            setCursorPos((p) => p + input.length);
        }
    }, { isActive: focus });

    const before = value.slice(0, cursorPos);
    const cursor = value[cursorPos] ?? ' ';
    const after = value.slice(cursorPos + 1);
    const showPlaceholder = value.length === 0 && !focus;

    return (
        <Box>
            {showPlaceholder ? (
                <Text dimColor>{placeholder}</Text>
            ) : (
                <>
                    <Text>{before}</Text>
                    <Text inverse>{cursor}</Text>
                    <Text>{after}</Text>
                </>
            )}
        </Box>
    );
}
