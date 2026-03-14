// ============================================================
// 终端编辑器组件
// - TextAreaInput 作为单一输入表面，负责单行/多行编辑
// - Enter: 发送消息
// - 整个草稿以反斜杠结尾时，Enter 会把它替换成换行
// - Ctrl+E: 打开外部编辑器 ($EDITOR)
// - @: 文件补全
// - /: slash 命令补全
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getTheme, themeColor, createThemedStyles } from './theme.js';
import type { SlashCommandDef } from './commands.js';
import { formatAttachmentDisplayLabel } from './attachments.js';
import { TextAreaInput } from './textarea-input.js';
import { clampOffset } from './editor-model.js';
import {
    padDisplayText,
    truncateDisplayText,
    type WrappedEditorLayout,
    type WrappedEditorRow,
} from './editor-layout.js';

const MAX_COMPLETIONS = 12;
export const COMPLETION_DROPDOWN_PAGE_SIZE = 8;

export type { WrappedEditorRow, WrappedEditorLayout };

export {
    buildTerminalCursorPosition,
    buildWrappedEditorLayout,
    clampTerminalCoordinate,
    measureEditorRows,
    wrapEditorLine,
} from './editor-layout.js';
export { formatAttachmentDisplayLabel } from './attachments.js';

export interface CompletionState {
    completions: string[];
    selectedIndex: number;
    atOffset: number;
    kind: 'file' | 'slash';
}

export function getCompletionDropdownHeight(completion: CompletionState): number {
    const visibleCount = Math.min(COMPLETION_DROPDOWN_PAGE_SIZE, completion.completions.length);
    const page = Math.floor(completion.selectedIndex / COMPLETION_DROPDOWN_PAGE_SIZE);
    const scrollOffset = Math.max(0, page * COMPLETION_DROPDOWN_PAGE_SIZE);
    const hasAbove = scrollOffset > 0;
    const hasBelow = scrollOffset + COMPLETION_DROPDOWN_PAGE_SIZE < completion.completions.length;

    // border(2) + header(1) + visible items + footer(1) + optional above/below hints
    return 4 + visibleCount + (hasAbove ? 1 : 0) + (hasBelow ? 1 : 0);
}

export function navigateCompletionSelection(
    state: CompletionState,
    delta: -1 | 1,
): CompletionState {
    return {
        ...state,
        selectedIndex: Math.max(0, Math.min(state.completions.length - 1, state.selectedIndex + delta)),
    };
}

interface NavigationTailGuard {
    direction: 'up' | 'down';
    expiresAt: number;
}

export function isIgnorableNavigationTail(
    guard: NavigationTailGuard | null,
    input: string,
    now: number = Date.now(),
): boolean {
    if (!guard || now > guard.expiresAt) {
        return false;
    }

    const seq = input.replace(/\u0000/g, '');
    const expected = guard.direction === 'up' ? 'A' : 'B';

    return seq === '\u001b'
        || seq === '['
        || seq === 'O'
        || seq === expected
        || seq === `[${expected}`
        || seq === `O${expected}`
        || seq === `\u001b[${expected}`
        || seq === `\u001bO${expected}`
        || /^\u001b\[[0-9;]*$/.test(seq)
        || /^\[[0-9;]*$/.test(seq);
}

export function scanCompletions(cwd: string, query: string): string[] {
    try {
        const queryDir = path.dirname(query);
        const queryBase = path.basename(query);
        const scanDir = queryDir === '.' ? cwd : path.resolve(cwd, queryDir);

        const entries = fs.readdirSync(scanDir, { withFileTypes: true });
        const matched: Array<{ rel: string; isDirectory: boolean }> = [];
        const queryLower = queryBase.toLowerCase();

        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const nameLower = entry.name.toLowerCase();
            if (queryLower.length > 0 && !nameLower.includes(queryLower)) continue;

            const rel = queryDir === '.' ? entry.name : path.join(queryDir, entry.name);
            matched.push({
                rel: entry.isDirectory() ? `${rel}/` : rel,
                isDirectory: entry.isDirectory(),
            });
        }

        matched.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.rel.localeCompare(b.rel);
        });

        return matched.slice(0, MAX_COMPLETIONS).map((item) => item.rel);
    } catch {
        return [];
    }
}

export function findAtQuery(text: string, cursorPos: number): { start: number; query: string } | null {
    let index = cursorPos - 1;
    while (index >= 0) {
        const ch = text[index];
        if (ch === '@') {
            return { start: index, query: text.slice(index + 1, cursorPos) };
        }
        if (ch === ' ' || ch === '\n') break;
        index -= 1;
    }
    return null;
}

export function findSlashQuery(text: string, cursorPos: number): { start: number; query: string } | null {
    const lineStart = text.lastIndexOf('\n', cursorPos - 1) + 1;
    const lineText = text.slice(lineStart, cursorPos);
    if (!lineText.startsWith('/')) return null;
    const afterSlash = lineText.slice(1);
    if (afterSlash.includes(' ')) return null;
    return { start: lineStart, query: afterSlash };
}

export function resolveAcceptedCompletion(params: {
    value: string;
    cursorOffset: number;
    completion: CompletionState;
    slashCommands?: SlashCommandDef[];
}): { value: string; offset: number } | null {
    const selected = params.completion.completions[params.completion.selectedIndex];
    if (!selected) return null;

    const inserted = params.completion.kind === 'slash'
        ? `/${selected}${params.slashCommands?.find((command) => command.name === selected)?.args ? ' ' : ''}`
        : `@${selected}${selected.endsWith('/') ? '' : ' '}`;

    return {
        value:
            params.value.slice(0, params.completion.atOffset)
            + inserted
            + params.value.slice(params.cursorOffset),
        offset: params.completion.atOffset + inserted.length,
    };
}

export function shouldInsertTrailingBackslashNewline(value: string): boolean {
    return value.endsWith('\\');
}

export function normalizeExternalEditorContent(content: string): string | null {
    const normalized = content.replace(/\r\n?/g, '\n');
    return normalized.length > 0 ? normalized : null;
}

export function buildAttachmentDisplayText(attachments: string[], deleteMode: boolean): string {
    return attachments
        .map((attachment, index) => deleteMode
            ? `[${index}:${formatAttachmentDisplayLabel(attachment)}]`
            : `[${formatAttachmentDisplayLabel(attachment)}]`)
        .join(' ');
}

export function resolveAttachmentDeleteKey(params: {
    input: string;
    key: { ctrl?: boolean; escape?: boolean };
    deleteMode: boolean;
    attachmentsCount: number;
}): {
    handled: boolean;
    nextDeleteMode: boolean;
    clearAll?: boolean;
    removeIndex?: number;
} {
    if (params.key.ctrl && params.input === 'r' && params.attachmentsCount > 0) {
        return {
            handled: true,
            nextDeleteMode: true,
        };
    }

    if (!params.deleteMode) {
        return {
            handled: false,
            nextDeleteMode: false,
        };
    }

    if (params.key.escape || params.input === '\u001b') {
        return {
            handled: true,
            nextDeleteMode: false,
        };
    }

    if (params.input === 'r') {
        return {
            handled: true,
            nextDeleteMode: false,
            clearAll: true,
        };
    }

    if (/^\d$/.test(params.input)) {
        const index = Number(params.input);
        return {
            handled: true,
            nextDeleteMode: false,
            ...(index < params.attachmentsCount ? { removeIndex: index } : {}),
        };
    }

    return {
        handled: true,
        nextDeleteMode: true,
    };
}

function isUpNavigation(input: string, key: { upArrow?: boolean; ctrl?: boolean }): boolean {
    const seq = input.replace(/\u0000/g, '');
    return Boolean(
        key.upArrow
        || (key.ctrl && input === 'p')
        || seq === '\u001b[A'
        || seq === '[A'
        || seq === '\u001bOA'
        || seq === 'OA'
        || /^\[[0-9;]*A$/.test(seq)
        || /^\u001b\[[0-9;]*A$/.test(seq),
    );
}

function isDownNavigation(input: string, key: { downArrow?: boolean; ctrl?: boolean }): boolean {
    const seq = input.replace(/\u0000/g, '');
    return Boolean(
        key.downArrow
        || (key.ctrl && input === 'n')
        || seq === '\u001b[B'
        || seq === '[B'
        || seq === '\u001bOB'
        || seq === 'OB'
        || /^\[[0-9;]*B$/.test(seq)
        || /^\u001b\[[0-9;]*B$/.test(seq),
    );
}

export function parsePendingNavigation(
    buffered: string,
    input: string,
): { action: 'up' | 'down' | 'pending' | null; nextBuffer: string } {
    const merged = `${buffered}${input}`.replace(/\u0000/g, '');
    if (!merged) return { action: null, nextBuffer: '' };

    const completedSequence = merged.match(/(?:\u001b\[[0-9;]*[AB]|\[[0-9;]*[AB]|\u001bO[AB]|O[AB])$/)?.[0];
    if (completedSequence) {
        const direction = completedSequence.endsWith('A') ? 'up' : 'down';
        return { action: direction, nextBuffer: '' };
    }

    if (
        merged.endsWith('[A')
        || merged.endsWith('OA')
        || /^\u001b\[[0-9;]*A$/.test(merged)
        || /^\[[0-9;]*A$/.test(merged)
        || /^OA$/.test(merged)
    ) {
        return { action: 'up', nextBuffer: '' };
    }
    if (
        merged.endsWith('[B')
        || merged.endsWith('OB')
        || /^\u001b\[[0-9;]*B$/.test(merged)
        || /^\[[0-9;]*B$/.test(merged)
        || /^OB$/.test(merged)
    ) {
        return { action: 'down', nextBuffer: '' };
    }

    // In some terminals, arrow sequences arrive as split fragments.
    // Keep buffering known prefixes until we can resolve A/B.
    if (
        merged === '\u001b'
        || merged === '['
        || merged === 'O'
        || merged === '\u001b['
        || merged === '\u001bO'
        || /^\u001b\[[0-9;]*$/.test(merged)
        || merged === '['
        || merged === 'O'
        || /^\[[0-9;]*$/.test(merged)
    ) {
        return { action: 'pending', nextBuffer: merged };
    }

    return { action: null, nextBuffer: '' };
}

export interface EditorProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    width: number;
    maxHeight?: number;
    placeholder?: string;
    attachments?: string[];
    onRemoveAttachment?: (index: number) => void;
    onClearAttachments?: () => void;
    cwd?: string;
    slashCommands?: SlashCommandDef[];
    completion?: CompletionState | null;
    onCompletionChange?: React.Dispatch<React.SetStateAction<CompletionState | null>>;
    isActive?: boolean;
}

export function Editor({
    value,
    onChange,
    onSubmit,
    width,
    maxHeight = 8,
    placeholder = 'Type a message...  /cmd  !shell  @file',
    attachments = [],
    onRemoveAttachment,
    onClearAttachments,
    cwd,
    slashCommands = [],
    completion = null,
    onCompletionChange,
    isActive = true,
}: EditorProps): React.JSX.Element {
    const theme = getTheme();
    const [cursorOffset, setCursorOffset] = useState(() => clampOffset(value, value.length));
    const [deleteMode, setDeleteMode] = useState(false);
    const escapeSeqBuffer = useRef('');
    const navigationTailGuard = useRef<NavigationTailGuard | null>(null);

    const prevValueForCursorRef = useRef(value);
    useEffect(() => {
        const prevValue = prevValueForCursorRef.current;
        prevValueForCursorRef.current = value;

        setCursorOffset((prev) => {
            const isAtEnd = prev >= prevValue.length;
            if (isAtEnd && value.length > prevValue.length) {
                return value.length;
            }
            return clampOffset(value, prev);
        });
    }, [value]);

    useEffect(() => {
        updateCompletion(value, cursorOffset);
    }, [value, cursorOffset, cwd, slashCommands, completion, onCompletionChange]);

    useEffect(() => {
        if (attachments.length === 0 && deleteMode) {
            setDeleteMode(false);
        }
    }, [attachments.length, deleteMode]);

    function updateCompletion(nextValue: string, nextOffset: number): void {
        if (!onCompletionChange) return;

        if (cwd) {
            const found = findAtQuery(nextValue, nextOffset);
            if (found) {
                const completions = scanCompletions(cwd, found.query);
                if (completions.length > 0) {
                    const prevSelectedIndex = completion?.atOffset === found.start && completion?.kind === 'file'
                        ? completion.selectedIndex
                        : 0;
                    onCompletionChange({
                        completions,
                        atOffset: found.start,
                        selectedIndex: Math.min(prevSelectedIndex, completions.length - 1),
                        kind: 'file',
                    });
                    return;
                }
            }
        }

        if (slashCommands.length > 0) {
            const found = findSlashQuery(nextValue, nextOffset);
            if (found) {
                const query = found.query.toLowerCase();
                const completions = slashCommands
                    .filter((command) => command.name.startsWith(query))
                    .map((command) => command.name);

                if (completions.length > 0) {
                    const prevSelectedIndex = completion?.atOffset === found.start && completion?.kind === 'slash'
                        ? completion.selectedIndex
                        : 0;
                    onCompletionChange({
                        completions,
                        atOffset: found.start,
                        selectedIndex: Math.min(prevSelectedIndex, completions.length - 1),
                        kind: 'slash',
                    });
                    return;
                }
            }
        }

        onCompletionChange(null);
    }

    function acceptCompletion(state: CompletionState): void {
        const resolved = resolveAcceptedCompletion({
            value,
            cursorOffset,
            completion: state,
            slashCommands,
        });
        if (!resolved) return;

        onChange(resolved.value);
        setCursorOffset(resolved.offset);
        onCompletionChange?.(null);
    }

    function openExternalEditor(): void {
        const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'nvim';
        const tmpFile = path.join(os.tmpdir(), `xqoder-edit-${Date.now()}.md`);
        try {
            fs.writeFileSync(tmpFile, '', 'utf8');
            spawnSync(editor, [tmpFile], { stdio: 'inherit' });
            const edited = fs.readFileSync(tmpFile, 'utf8');
            fs.unlinkSync(tmpFile);
            const nextValue = normalizeExternalEditorContent(edited);
            if (!nextValue) {
                return;
            }

            onSubmit(nextValue);
            onCompletionChange?.(null);
        } catch {
            // ignore
        }
    }

    function armNavigationTail(direction: 'up' | 'down'): void {
        navigationTailGuard.current = {
            direction,
            expiresAt: Date.now() + 80,
        };
    }

    function handleCompletionKey(
        input: string,
        key: {
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
        },
    ): boolean {
        if (!completion) {
            escapeSeqBuffer.current = '';
            return false;
        }

        if (isIgnorableNavigationTail(navigationTailGuard.current, input)) {
            return true;
        }

        if (!key.upArrow && !key.downArrow) {
            const parsed = parsePendingNavigation(escapeSeqBuffer.current, input);
            escapeSeqBuffer.current = parsed.nextBuffer;
            if (parsed.action === 'pending') {
                return true;
            }
            if (parsed.action === 'up') {
                armNavigationTail('up');
                onCompletionChange?.((current) => {
                    if (!current) return current;
                    return navigateCompletionSelection(current, -1);
                });
                return true;
            }
            if (parsed.action === 'down') {
                armNavigationTail('down');
                onCompletionChange?.((current) => {
                    if (!current) return current;
                    return navigateCompletionSelection(current, 1);
                });
                return true;
            }
        } else {
            escapeSeqBuffer.current = '';
        }

        if (isUpNavigation(input, key)) {
            armNavigationTail('up');
            onCompletionChange?.((current) => {
                if (!current) return current;
                return navigateCompletionSelection(current, -1);
            });
            return true;
        }

        if (isDownNavigation(input, key)) {
            armNavigationTail('down');
            onCompletionChange?.((current) => {
                if (!current) return current;
                return navigateCompletionSelection(current, 1);
            });
            return true;
        }

        if (key.return || key.tab) {
            acceptCompletion(completion);
            return true;
        }

        if (input === '\u001b' || key.escape) {
            onCompletionChange?.(null);
            return true;
        }

        escapeSeqBuffer.current = '';
        return false;
    }

    function handleAttachmentKey(
        input: string,
        key: {
            ctrl?: boolean;
            escape?: boolean;
        },
    ): boolean {
        const next = resolveAttachmentDeleteKey({
            input,
            key,
            deleteMode,
            attachmentsCount: attachments.length,
        });

        if (!next.handled) {
            return false;
        }

        setDeleteMode(next.nextDeleteMode);
        if (next.clearAll) {
            onClearAttachments?.();
        }
        if (typeof next.removeIndex === 'number') {
            onRemoveAttachment?.(next.removeIndex);
        }
        return true;
    }

    return (
        <Box flexDirection="column" width={width}>
            {attachments.length > 0 && (
                <Text>{createThemedStyles(theme).muted(buildAttachmentDisplayText(attachments, deleteMode))}</Text>
            )}
            <TextAreaInput
                value={value}
                onChange={onChange}
                cursorOffset={cursorOffset}
                onCursorChange={setCursorOffset}
                onSubmit={onSubmit}
                onOpenExternalEditor={openExternalEditor}
                onInterceptKey={handleAttachmentKey}
                onCompletionKey={handleCompletionKey}
                completionOpen={Boolean(completion)}
                width={width}
                maxHeight={maxHeight}
                placeholder={placeholder}
                isActive={isActive}
            />
        </Box>
    );
}

interface CompletionDropdownProps {
    completion: CompletionState;
    width: number;
    slashCommands?: SlashCommandDef[];
}

export function CompletionDropdown({ completion, width, slashCommands = [] }: CompletionDropdownProps): React.JSX.Element {
    const theme = getTheme();
    const styles = createThemedStyles(theme);
    const pageSize = COMPLETION_DROPDOWN_PAGE_SIZE;
    const total = completion.completions.length;
    const selected = completion.selectedIndex;
    const isSlash = completion.kind === 'slash';
    const page = Math.floor(selected / pageSize);
    const scrollOffset = Math.max(0, page * pageSize);
    const visibleItems = completion.completions.slice(scrollOffset, scrollOffset + pageSize);
    const hasAbove = scrollOffset > 0;
    const hasBelow = scrollOffset + pageSize < total;
    const maxRowWidth = Math.max(12, width - 6);
    const padded = (text: string) => padDisplayText(truncateDisplayText(text, maxRowWidth), maxRowWidth);
    const headerHint = isSlash
        ? '/ cmd  ↑↓/Ctrl+N,P select  Tab/Enter confirm'
        : '@ file  ↑↓/Ctrl+N,P select  Tab/Enter confirm';

    return (
        <Box flexDirection="column" borderStyle="single" borderColor={themeColor(theme, theme.accent)} width={width}>
            <Box paddingX={1}>
                <Text>{padded(headerHint)}</Text>
            </Box>
            {hasAbove && (
                <Box paddingX={1}>
                    <Text>{padded(`  ↑ ${scrollOffset} more above`)}</Text>
                </Box>
            )}
            {visibleItems.map((item, index) => {
                const absoluteIndex = scrollOffset + index;
                const isSelected = absoluteIndex === selected;
                const cmdDef = isSlash ? slashCommands.find((command) => command.name === item) : undefined;
                const desc = cmdDef?.description;
                const args = cmdDef?.args ? ` ${cmdDef.args}` : '';
                const label = isSlash ? `/${item}${args}` : item;
                const prefix = isSelected ? '▶' : ' ';
                const content = truncateDisplayText(`${label}${desc ? `  ·  ${desc}` : ''}`, maxRowWidth - 2);
                const rowText = padDisplayText(content, maxRowWidth - 2);

                return (
                    <Box key={item} paddingX={1}>
                        <Text>
                            {isSelected ? styles.accent(`${prefix} `) : '  '}
                            {isSelected
                                ? chalk.inverse(rowText)
                                : rowText}
                        </Text>
                    </Box>
                );
            })}
            {hasBelow && (
                <Box paddingX={1}>
                    <Text>{padded(`  ↓ ${total - scrollOffset - pageSize} more below`)}</Text>
                </Box>
            )}
            <Box paddingX={1}>
                <Text>{padded(`  selected ${selected + 1}/${total}`)}</Text>
            </Box>
        </Box>
    );
}
