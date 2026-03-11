/**
 * ImeTextInput — ink-text-input 的 IME 友好替代组件
 *
 * 光标：仅隐藏终端真实光标（setCursorPosition(undefined)），不移动其位置；
 * 光标由组件内反色（chalk.inverse）自绘，避免 IME/长文导致终端崩溃（借鉴 OpenCode/OpenTUI）。
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useCursor } from 'ink';
import chalk from 'chalk';
import { sanitizeSingleLineTerminalInput } from './terminal-input.js';

// ---------------------------------------------------------------------------
// CJK 宽度计算 — 中日韩全角字符占 2 列
// ---------------------------------------------------------------------------

function charDisplayWidth(char: string): number {
    const code = char.codePointAt(0);
    if (code === undefined) {
        return 1;
    }

    // CJK Unified Ideographs
    if (code >= 0x4E00 && code <= 0x9FFF) return 2;
    // CJK Extension A
    if (code >= 0x3400 && code <= 0x4DBF) return 2;
    // CJK Extension B–F, Supplement
    if (code >= 0x20000 && code <= 0x2FA1F) return 2;
    // CJK Compatibility Ideographs
    if (code >= 0xF900 && code <= 0xFAFF) return 2;
    // Fullwidth forms
    if (code >= 0xFF01 && code <= 0xFF60) return 2;
    if (code >= 0xFFE0 && code <= 0xFFE6) return 2;
    // Hangul Syllables
    if (code >= 0xAC00 && code <= 0xD7AF) return 2;
    // CJK Symbols and Punctuation
    if (code >= 0x3000 && code <= 0x303F) return 2;
    // Hiragana & Katakana
    if (code >= 0x3040 && code <= 0x30FF) return 2;
    // Bopomofo
    if (code >= 0x3100 && code <= 0x312F) return 2;
    // Enclosed CJK
    if (code >= 0x3200 && code <= 0x32FF) return 2;

    return 1;
}

function stringDisplayWidth(str: string): number {
    let width = 0;
    for (const char of str) {
        width += charDisplayWidth(char);
    }
    return width;
}

// ---------------------------------------------------------------------------
// ImeTextInput 组件
// ---------------------------------------------------------------------------

export interface ImeTextInputProps {
    /** 受控值 */
    value: string;
    /** 值变更回调 */
    onChange: (value: string) => void;
    /** 提交回调 */
    onSubmit?: (value: string) => void;
    /** 占位符文本 */
    placeholder?: string;
    /** 是否聚焦 */
    focus?: boolean;
    /** 字符遮罩 */
    mask?: string;
    /** 是否显示光标 */
    showCursor?: boolean;
    /** 是否高亮粘贴内容 */
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

    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);


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
                // IME/拼音路径异常时不更新状态，避免闪退
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
