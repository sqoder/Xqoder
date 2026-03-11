// ============================================================
// 弹窗系统 — Dialog / Overlay 组件
// 参考 OpenCode: components/dialog/
// ============================================================

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getTheme, createThemedStyles, getThemeName, getThemeNames, setTheme, themes } from './theme.js';
import type { SessionInfo } from './sidebar.js';

const MAX_DIALOG_LIST_ITEMS = 10;

export function getNextListIndex(currentIndex: number, total: number, direction: 'prev' | 'next'): number {
    if (total <= 0) {
        return 0;
    }

    if (direction === 'prev') {
        return currentIndex > 0 ? currentIndex - 1 : total - 1;
    }

    return currentIndex < total - 1 ? currentIndex + 1 : 0;
}

export function getVisibleListWindow(total: number, selectedIndex: number, pageSize: number = MAX_DIALOG_LIST_ITEMS): { start: number; end: number } {
    if (total <= 0) {
        return { start: 0, end: 0 };
    }

    const safePageSize = Math.max(1, pageSize);
    const safeSelected = Math.max(0, Math.min(selectedIndex, total - 1));
    const maxStart = Math.max(0, total - safePageSize);
    const centeredStart = Math.max(0, safeSelected - Math.floor(safePageSize / 2));
    const start = Math.min(centeredStart, maxStart);
    return {
        start,
        end: Math.min(total, start + safePageSize),
    };
}

export function resolveInitialThemeIndex(themeNames: string[], currentThemeName: string): number {
    const foundIndex = themeNames.findIndex((themeName) => themeName === currentThemeName);
    return foundIndex >= 0 ? foundIndex : 0;
}

// ============================================================
// DialogOverlay — 居中覆盖层容器
// ============================================================

interface DialogOverlayProps {
    appWidth: number;
    appHeight: number;
    children: React.ReactNode;
    /** 弹窗内容宽度（默认 60）*/
    dialogWidth?: number;
    /** 弹窗内容高度（默认 auto）*/
    dialogHeight?: number;
}

/**
 * Full-screen overlay that blanks the background before rendering the dialog.
 * Ink has no z-index — we fill every row with spaces so the underlying
 * ChatPage content is fully hidden, then render the dialog on top.
 */
export function DialogOverlay({
    appWidth,
    appHeight,
    children,
    dialogWidth = 60,
    dialogHeight,
}: DialogOverlayProps): React.JSX.Element {
    const theme = getTheme();
    const innerW = Math.min(dialogWidth, appWidth - 4);
    const leftPad = Math.max(0, Math.floor((appWidth - innerW) / 2));
    const topPad = dialogHeight
        ? Math.max(0, Math.floor((appHeight - dialogHeight) / 2))
        : Math.max(1, Math.floor(appHeight / 4));

    const blankLine = ' '.repeat(appWidth);

    return (
        <Box
            position="absolute"
            width={appWidth}
            height={appHeight}
            flexDirection="column"
        >
            {/* Opaque background — fill every row to hide underlying content */}
            {Array.from({ length: appHeight }, (_, i) => (
                <Box key={`bg-${i}`} position="absolute" marginTop={i}>
                    <Text color={theme.textMuted}>{blankLine}</Text>
                </Box>
            ))}

            {/* Centered dialog content */}
            <Box height={topPad} />
            <Box flexDirection="row">
                <Box width={leftPad} />
                <Box width={innerW} flexDirection="column">
                    {children}
                </Box>
            </Box>
        </Box>
    );
}

// ============================================================
// 通用弹窗容器
// ============================================================

interface DialogProps {
    title: string;
    width: number;
    height?: number;
    onClose: () => void;
    children: React.ReactNode;
}

export function Dialog({
    title,
    width,
    height,
    onClose,
    children,
}: DialogProps): React.JSX.Element {
    const theme = getTheme();
    const innerWidth = Math.min(width - 4, 70);

    useInput((_input, key) => {
        if (key.escape) onClose();
    });

    return (
        <Box
            flexDirection="column"
            width={innerWidth}
            height={height}
            borderStyle="round"
            borderColor={theme.borderFocused}
            paddingX={1}
        >
            <Box justifyContent="space-between" marginBottom={1}>
                <Text bold>
                    {chalk.hex(theme.primary)(title)}
                </Text>
                <Text>{chalk.hex(theme.textMuted)('ESC to close')}</Text>
            </Box>
            {children}
        </Box>
    );
}

// ============================================================
// HelpDialog — 完整快捷键参考
// ============================================================

interface HelpDialogProps {
    width: number;
    onClose: () => void;
}

interface HelpEntry {
    key: string;
    description: string;
}

const HELP_ENTRIES: HelpEntry[] = [
    { key: 'Enter', description: 'Send message' },
    { key: '\\ + Enter', description: 'Insert newline in message' },
    { key: '@', description: 'Trigger file path completion' },
    { key: 'Tab', description: 'Cycle agent (general → plan → coder)' },
    { key: 'Ctrl+E', description: 'Open external editor' },
    { key: 'Ctrl+C', description: 'Quit immediately' },
    { key: 'Ctrl+?', description: 'Show this help dialog' },
    { key: 'Ctrl+T', description: 'Switch theme' },
    { key: 'Ctrl+S', description: 'Session switcher' },
    { key: 'Ctrl+O', description: 'Model selector' },
    { key: 'Ctrl+K', description: 'Command palette' },
    { key: 'Ctrl+F', description: 'File picker' },
    { key: 'Ctrl+L', description: 'Toggle logs page' },
    { key: 'Ctrl+G', description: 'Toggle mouse mode (terminal/app)' },
    { key: 'Ctrl+Y', description: 'Copy last AI reply' },
    { key: 'Escape', description: 'Close dialog / Go back' },
    { key: 'PageUp / Ctrl+U', description: 'Scroll messages up' },
    { key: 'PageDown / Ctrl+D', description: 'Scroll messages down' },
];

export function HelpDialog({ width, onClose }: HelpDialogProps): React.JSX.Element {
    const theme = getTheme();
    const styles = createThemedStyles(theme);

    return (
        <Dialog title="⌨  Keyboard Shortcuts" width={width} onClose={onClose}>
            <Box flexDirection="column">
                {HELP_ENTRIES.map((entry) => (
                    <Box key={entry.key} gap={2}>
                        <Box width={18}>
                            <Text>{styles.accent(entry.key.padEnd(16))}</Text>
                        </Box>
                        <Text>{styles.text(entry.description)}</Text>
                    </Box>
                ))}
            </Box>
        </Dialog>
    );
}

// ============================================================
// ThemeDialog — 主题选择弹窗
// ============================================================

interface ThemeDialogProps {
    width: number;
    onClose: () => void;
    onThemeChange: (theme: string) => void;
}

export function ThemeDialog({
    width,
    onClose,
    onThemeChange,
}: ThemeDialogProps): React.JSX.Element {
    const theme = getTheme();
    const styles = createThemedStyles(theme);
    const themeNames = useMemo(() => getThemeNames(), []);
    const [selectedIndex, setSelectedIndex] = useState(() => resolveInitialThemeIndex(themeNames, getThemeName()));

    const visibleWindow = getVisibleListWindow(themeNames.length, selectedIndex);
    const visibleThemeNames = themeNames.slice(visibleWindow.start, visibleWindow.end);

    useInput((_input, key) => {
        if (key.upArrow) {
            setSelectedIndex((current) => getNextListIndex(current, themeNames.length, 'prev'));
        } else if (key.downArrow) {
            setSelectedIndex((current) => getNextListIndex(current, themeNames.length, 'next'));
        } else if (key.return) {
            const name = themeNames[selectedIndex];
            if (name) {
                setTheme(name);
                onThemeChange(name);
            }
            onClose();
        }
    });

    return (
        <Dialog title="🎨  Select Theme" width={width} onClose={onClose}>
            <Box flexDirection="column">
                {visibleWindow.start > 0 && (
                    <Text>{styles.muted(`... ${visibleWindow.start} above`)}</Text>
                )}
                {visibleThemeNames.map((name, visibleIndex) => {
                    const i = visibleWindow.start + visibleIndex;
                    const isSelected = i === selectedIndex;
                    const isCurrent = name === getThemeName();
                    const themeColors = themes[name];
                    const swatches = themeColors
                        ? chalk.bgHex(themeColors.primary)('  ')
                            + chalk.bgHex(themeColors.secondary)('  ')
                            + chalk.bgHex(themeColors.accent)('  ')
                            + chalk.bgHex(themeColors.success)('  ')
                            + chalk.bgHex(themeColors.error)('  ')
                        : '';
                    return (
                        <Box key={name}>
                            <Text>
                                {isSelected ? styles.accent('▸ ') : '  '}
                                {isSelected ? chalk.inverse(` ${name.padEnd(12)} `) : ` ${name.padEnd(12)} `}
                                {swatches}
                                {isCurrent ? ' (current)' : ''}
                            </Text>
                        </Box>
                        );
                    })}
                {visibleWindow.end < themeNames.length && (
                    <Text>{styles.muted(`... ${themeNames.length - visibleWindow.end} below`)}</Text>
                )}
            </Box>
        </Dialog>
    );
}

// ============================================================
// ConfirmDialog — 确认弹窗
// ============================================================

interface ConfirmDialogProps {
    title: string;
    message: string;
    width: number;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmDialog({
    title,
    message,
    width,
    onConfirm,
    onCancel,
}: ConfirmDialogProps): React.JSX.Element {
    const theme = getTheme();
    const styles = createThemedStyles(theme);
    const [selected, setSelected] = useState<'yes' | 'no'>('no');

    useInput((_input, key) => {
        if (key.leftArrow || key.rightArrow || key.tab) {
            setSelected(selected === 'yes' ? 'no' : 'yes');
        } else if (key.return) {
            if (selected === 'yes') onConfirm();
            else onCancel();
        } else if (key.escape) {
            onCancel();
        }
    });

    return (
        <Dialog title={title} width={width} onClose={onCancel}>
            <Box flexDirection="column">
                <Text wrap="wrap">{message}</Text>
                <Box marginTop={1} gap={3}>
                    <Text>
                        {selected === 'yes'
                            ? chalk.bgHex(theme.primary).hex(theme.background).bold(' Yes ')
                            : styles.muted(' Yes ')}
                    </Text>
                    <Text>
                        {selected === 'no'
                            ? chalk.bgHex(theme.error).hex(theme.background).bold(' No ')
                            : styles.muted(' No ')}
                    </Text>
                </Box>
            </Box>
        </Dialog>
    );
}

// ============================================================
// CommandPalette — 命令面板
// ============================================================

interface CommandEntry {
    id: string;
    label: string;
    shortcut?: string;
    action: () => void;
}

interface CommandPaletteProps {
    commands: CommandEntry[];
    width: number;
    onClose: () => void;
}

export function CommandPalette({
    commands,
    width,
    onClose,
}: CommandPaletteProps): React.JSX.Element {
    const theme = getTheme();
    const styles = createThemedStyles(theme);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [filter, setFilter] = useState('');

    const filtered = commands.filter(cmd =>
        cmd.label.toLowerCase().includes(filter.toLowerCase()),
    );
    const visibleWindow = getVisibleListWindow(filtered.length, selectedIndex);
    const visibleCommands = filtered.slice(visibleWindow.start, visibleWindow.end);

    useEffect(() => {
        setSelectedIndex((current) => Math.max(0, Math.min(current, filtered.length - 1)));
    }, [filtered.length]);

    useInput((input, key) => {
        if (key.upArrow) {
            setSelectedIndex((current) => getNextListIndex(current, filtered.length, 'prev'));
        } else if (key.downArrow) {
            setSelectedIndex((current) => getNextListIndex(current, filtered.length, 'next'));
        } else if (key.return && filtered[selectedIndex]) {
            filtered[selectedIndex]!.action();
            onClose();
        } else if (key.backspace || key.delete) {
            setFilter(f => f.slice(0, -1));
            setSelectedIndex(0);
        } else if (input && !key.ctrl && !key.meta) {
            setFilter(f => f + input);
            setSelectedIndex(0);
        }
    });

    return (
        <Dialog title="⚡  Commands" width={width} onClose={onClose}>
            <Box flexDirection="column">
                <Box marginBottom={1}>
                    <Text>
                        {styles.muted('> ')}
                        {styles.text(filter)}
                        {styles.accent('█')}
                    </Text>
                </Box>
                {visibleWindow.start > 0 && (
                    <Text>{styles.muted(`... ${visibleWindow.start} above`)}</Text>
                )}
                {visibleCommands.map((cmd, visibleIndex) => {
                    const absoluteIndex = visibleWindow.start + visibleIndex;
                    const isSelected = absoluteIndex === selectedIndex;
                    return (
                        <Box key={cmd.id} justifyContent="space-between">
                            <Text>
                                {isSelected ? styles.accent('▸ ') : '  '}
                                {isSelected ? styles.emphasized(cmd.label) : styles.text(cmd.label)}
                            </Text>
                            {cmd.shortcut && (
                                <Text>{styles.muted(cmd.shortcut)}</Text>
                            )}
                        </Box>
                    );
                })}
                {visibleWindow.end < filtered.length && (
                    <Text>{styles.muted(`... ${filtered.length - visibleWindow.end} below`)}</Text>
                )}
                {filtered.length === 0 && (
                    <Text>{styles.muted('No commands found')}</Text>
                )}
            </Box>
        </Dialog>
    );
}

// ============================================================
// PermissionDialog — 工具调用权限审批
// ============================================================

export interface PermissionRequest {
    toolCallId?: string;
    toolName: string;
    summary?: string;
    reason?: string;
    preview?: string;
    risk?: 'low' | 'medium' | 'high';
}

interface PermissionDialogProps {
    request: PermissionRequest;
    width: number;
    onAllowOnce: () => void;
    onAllowAlways: () => void;
    onDeny: () => void;
}

export function PermissionDialog({
    request,
    width,
    onAllowOnce,
    onAllowAlways,
    onDeny,
}: PermissionDialogProps): React.JSX.Element {
    const theme = getTheme();
    const styles = createThemedStyles(theme);
    type ButtonType = 'allow-once' | 'allow-always' | 'deny';
    const [selected, setSelected] = useState<ButtonType>('allow-once');
    const openedAtMs = useRef<number>(Date.now());

    useEffect(() => {
        openedAtMs.current = Date.now();
    }, []);

    const buttons: ButtonType[] = ['allow-once', 'allow-always', 'deny'];

    useInput((input, key) => {
        if (Date.now() - openedAtMs.current < 220) {
            return;
        }
        if (key.leftArrow) {
            const idx = buttons.indexOf(selected);
            setSelected(buttons[getNextListIndex(idx, buttons.length, 'prev')] ?? 'allow-once');
        } else if (key.rightArrow) {
            const idx = buttons.indexOf(selected);
            setSelected(buttons[getNextListIndex(idx, buttons.length, 'next')] ?? 'deny');
        } else if (key.return) {
            if (selected === 'allow-once') onAllowOnce();
            else if (selected === 'allow-always') onAllowAlways();
            else onDeny();
        } else if (input === 'a') {
            onAllowOnce();
        } else if (input === 's') {
            onAllowAlways();
        } else if (input === 'd') {
            onDeny();
        }
    });

    return (
        <Dialog title="🔐  Permission Request" width={width} onClose={onDeny}>
            <Box flexDirection="column">
                <Box marginBottom={1}>
                    <Text>
                        {styles.warning('Tool: ')}
                        {styles.emphasized(request.toolName)}
                    </Text>
                </Box>
                {request.summary && (
                    <Box marginBottom={1} flexDirection="column">
                        <Text>{request.summary}</Text>
                    </Box>
                )}
                {request.reason && (
                    <Box marginBottom={1} flexDirection="column">
                        <Text>{styles.muted(`Reason: ${request.reason}`)}</Text>
                    </Box>
                )}
                {request.preview && (
                    <Box marginBottom={1} flexDirection="column">
                        <Text>{styles.muted(request.preview.slice(0, 220))}</Text>
                    </Box>
                )}
                {request.risk && (
                    <Box marginBottom={1} flexDirection="column">
                        <Text>{styles.muted(`Risk: ${request.risk}`)}</Text>
                    </Box>
                )}
                <Box gap={2} marginTop={1}>
                    {buttons.map((btn) => {
                        const isSelected = btn === selected;
                        const labels: Record<ButtonType, string> = {
                            'allow-once': ' Yes (a) ',
                            'allow-always': ' Yes, allow all next time (s) ',
                            'deny': ' Deny (d) ',
                        };
                        const colors: Record<ButtonType, string> = {
                            'allow-once': theme.success,
                            'allow-always': theme.info,
                            'deny': theme.error,
                        };
                        const label = labels[btn];
                        return (
                            <Text key={btn}>
                                {isSelected
                                    ? chalk.bgHex(colors[btn]).hex(theme.background).bold(label)
                                    : styles.muted(label)}
                            </Text>
                        );
                    })}
                </Box>
                <Box marginTop={1}>
                    <Text>{styles.muted('← → navigate  a/s/d quick select  Enter confirm')}</Text>
                </Box>
            </Box>
        </Dialog>
    );
}

// ============================================================
// ModelSelectorDialog — 模型选择弹窗
// ============================================================

interface ModelEntry {
    provider: string;
    model: string;
    label: string;
}

const MODEL_LIST: ModelEntry[] = [
    { provider: 'anthropic', model: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { provider: 'openai', model: 'gpt-4o', label: 'GPT-4o' },
    { provider: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { provider: 'openai', model: 'o3-mini', label: 'o3 mini' },
    { provider: 'google', model: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { provider: 'google', model: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro' },
];

const PROVIDERS = [...new Set(MODEL_LIST.map(m => m.provider))];

export function resolveInitialModelSelection(currentModel: string | undefined): { providerIdx: number; modelIdx: number } {
    if (!currentModel) {
        return { providerIdx: 0, modelIdx: 0 };
    }

    const modelEntry = MODEL_LIST.find((entry) => entry.model === currentModel);
    if (!modelEntry) {
        return { providerIdx: 0, modelIdx: 0 };
    }

    const providerIdx = Math.max(0, PROVIDERS.findIndex((provider) => provider === modelEntry.provider));
    const providerModels = MODEL_LIST.filter((entry) => entry.provider === modelEntry.provider);
    const modelIdx = Math.max(0, providerModels.findIndex((entry) => entry.model === currentModel));

    return { providerIdx, modelIdx };
}

interface ModelSelectorDialogProps {
    width: number;
    currentModel?: string;
    onSelect: (model: string) => void;
    onClose: () => void;
}

export function ModelSelectorDialog({
    width,
    currentModel,
    onSelect,
    onClose,
}: ModelSelectorDialogProps): React.JSX.Element {
    const theme = getTheme();
    const styles = createThemedStyles(theme);
    const [selection, setSelection] = useState(() => resolveInitialModelSelection(currentModel));

    useEffect(() => {
        setSelection(resolveInitialModelSelection(currentModel));
    }, [currentModel]);

    const providerIdx = selection.providerIdx;
    const modelIdx = selection.modelIdx;

    const currentProvider = PROVIDERS[providerIdx] ?? PROVIDERS[0] ?? 'anthropic';
    const providerModels = MODEL_LIST.filter(m => m.provider === currentProvider);
    const visibleWindow = getVisibleListWindow(providerModels.length, modelIdx);
    const visibleModels = providerModels.slice(visibleWindow.start, visibleWindow.end);

    useInput((_input, key) => {
        if (key.leftArrow) {
            setSelection((current) => ({
                providerIdx: getNextListIndex(current.providerIdx, PROVIDERS.length, 'prev'),
                modelIdx: 0,
            }));
        } else if (key.rightArrow) {
            setSelection((current) => ({
                providerIdx: getNextListIndex(current.providerIdx, PROVIDERS.length, 'next'),
                modelIdx: 0,
            }));
        } else if (key.upArrow) {
            setSelection((current) => ({
                ...current,
                modelIdx: getNextListIndex(current.modelIdx, providerModels.length, 'prev'),
            }));
        } else if (key.downArrow) {
            setSelection((current) => ({
                ...current,
                modelIdx: getNextListIndex(current.modelIdx, providerModels.length, 'next'),
            }));
        } else if (key.return) {
            const entry = providerModels[modelIdx];
            if (entry) {
                onSelect(entry.model);
                onClose();
            }
        }
    });

    return (
        <Dialog title="🤖  Select Model" width={width} onClose={onClose}>
            <Box flexDirection="column">
                {/* Provider 切换 */}
                <Box marginBottom={1} gap={2}>
                    {PROVIDERS.map((p, i) => (
                        <Text key={p}>
                            {i === providerIdx
                                ? chalk.bgHex(theme.primary).hex(theme.background).bold(` ${p} `)
                                : styles.muted(` ${p} `)}
                        </Text>
                    ))}
                    <Text>{styles.muted('  ← → switch provider')}</Text>
                </Box>

                {/* 模型列表 */}
                <Box flexDirection="column">
                    {visibleWindow.start > 0 && (
                        <Text>{styles.muted(`... ${visibleWindow.start} above`)}</Text>
                    )}
                    {visibleModels.map((entry, visibleIndex) => {
                        const i = visibleWindow.start + visibleIndex;
                        const isSelected = i === modelIdx;
                        const isCurrent = entry.model === currentModel;
                        return (
                            <Box key={entry.model}>
                                <Text>
                                    {isSelected ? styles.accent('▸ ') : '  '}
                                    {isSelected ? styles.emphasized(entry.label) : styles.text(entry.label)}
                                    {isCurrent ? styles.muted(' (current)') : ''}
                                </Text>
                            </Box>
                        );
                    })}
                    {visibleWindow.end < providerModels.length && (
                        <Text>{styles.muted(`... ${providerModels.length - visibleWindow.end} below`)}</Text>
                    )}
                </Box>

                <Box marginTop={1}>
                    <Text>{styles.muted('↑ ↓ navigate  Enter select')}</Text>
                </Box>
            </Box>
        </Dialog>
    );
}

// ============================================================
// SessionSelectorDialog — 会话切换弹窗
// ============================================================

interface SessionSelectorDialogProps {
    sessions: SessionInfo[];
    width: number;
    currentSessionId?: string;
    onSelect: (sessionId: string) => void;
    onNew: () => void;
    onDelete: (sessionId: string) => void;
    onClose: () => void;
}

export function SessionSelectorDialog({
    sessions,
    width,
    currentSessionId,
    onSelect,
    onNew,
    onDelete,
    onClose,
}: SessionSelectorDialogProps): React.JSX.Element {
    const theme = getTheme();
    const styles = createThemedStyles(theme);
    const [selectedIndex, setSelectedIndex] = useState(
        Math.max(0, sessions.findIndex(s => s.id === currentSessionId)),
    );
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => {
        setSelectedIndex(Math.max(0, sessions.findIndex((session) => session.id === currentSessionId)));
    }, [currentSessionId, sessions]);

    const visibleWindow = getVisibleListWindow(sessions.length, selectedIndex);
    const visibleSessions = sessions.slice(visibleWindow.start, visibleWindow.end);

    useInput((_input, key) => {
        // 删除确认模式
        if (confirmDelete) {
            if (_input === 'y' || _input === 'Y') {
                const session = sessions[selectedIndex];
                if (session) onDelete(session.id);
                setConfirmDelete(false);
            } else {
                setConfirmDelete(false);
            }
            return;
        }

        if (key.upArrow) {
            setSelectedIndex((current) => getNextListIndex(current, sessions.length, 'prev'));
        } else if (key.downArrow) {
            setSelectedIndex((current) => getNextListIndex(current, sessions.length, 'next'));
        } else if (key.return) {
            const session = sessions[selectedIndex];
            if (session) {
                onSelect(session.id);
                onClose();
            }
        } else if (_input === 'n' || _input === 'N') {
            onNew();
            onClose();
        } else if (_input === 'd' || _input === 'D') {
            const session = sessions[selectedIndex];
            if (session) setConfirmDelete(true);
        }
    });

    return (
        <Dialog title="💬  Switch Session" width={width} onClose={onClose}>
            <Box flexDirection="column">
                {sessions.length === 0 ? (
                    <Text>{styles.muted('No sessions found')}</Text>
                ) : (
                    visibleSessions.map((session, visibleIndex) => {
                        const index = visibleWindow.start + visibleIndex;
                        const isSelected = index === selectedIndex;
                        const isCurrent = session.id === currentSessionId;
                        const title = session.title.length > width - 12
                            ? session.title.slice(0, width - 15) + '...'
                            : session.title;

                        return (
                            <Box key={session.id} flexDirection="column">
                                <Box>
                                    <Text>
                                        {isSelected ? styles.accent('▸ ') : '  '}
                                        {isCurrent
                                            ? styles.emphasized(title)
                                            : isSelected
                                                ? styles.text(title)
                                                : styles.muted(title)}
                                        {isCurrent ? styles.muted(' ●') : ''}
                                    </Text>
                                </Box>
                                {isSelected && (
                                    <Box paddingLeft={4}>
                                        <Text>
                                            {styles.muted(
                                                `${session.messageCount} msgs · ${formatRelativeTime(session.updatedAt)}`,
                                            )}
                                        </Text>
                                    </Box>
                                )}
                            </Box>
                        );
                    })
                )}
                {sessions.length > MAX_DIALOG_LIST_ITEMS && (
                    <Box marginTop={1}>
                        <Text>{styles.muted(`${selectedIndex + 1}/${sessions.length}`)}</Text>
                    </Box>
                )}
                {confirmDelete ? (
                    <Box marginTop={1}>
                        <Text>
                            {chalk.hex(theme.warning)('Delete this session? ')}
                            {styles.emphasized('y')}
                            {styles.muted(' confirm  ')}
                            {styles.muted('any other key cancel')}
                        </Text>
                    </Box>
                ) : (
                    <Box marginTop={1}>
                        <Text>{styles.muted('↑↓ navigate  Enter select  N new  D delete  Esc close')}</Text>
                    </Box>
                )}
            </Box>
        </Dialog>
    );
}

// ============================================================
// InitDialog — 首次运行项目初始化对话框（OpenCode 风格）
// ============================================================

interface InitDialogProps {
    width: number;
    projectDir: string;
    onInitialize: () => void;
    onSkip: () => void;
    onClose: () => void;
}

export function InitDialog({
    width,
    projectDir,
    onInitialize,
    onSkip,
    onClose,
}: InitDialogProps): React.JSX.Element {
    const theme = getTheme();
    const [selected, setSelected] = useState<'init' | 'skip'>('init');

    useInput((input, key) => {
        if (key.escape) {
            onClose();
            return;
        }

        if (key.upArrow || key.downArrow || key.tab) {
            setSelected(prev => prev === 'init' ? 'skip' : 'init');
            return;
        }

        if (key.return) {
            if (selected === 'init') {
                onInitialize();
            } else {
                onSkip();
            }
        }
    });

    return (
        <Dialog width={width} title="Initialize Project" onClose={onClose}>
            <Box flexDirection="column" paddingX={1} paddingY={1}>
                <Text color={theme.text}>
                    Create an XQoder.md memory file for this project?
                </Text>
                <Text color={theme.textMuted} dimColor>
                    This helps the AI understand your codebase better.
                </Text>
                <Box marginTop={1} flexDirection="column">
                    <Box>
                        <Text color={selected === 'init' ? theme.primary : theme.textMuted}>
                            {selected === 'init' ? '▸ ' : '  '}Initialize — analyze codebase and create XQoder.md
                        </Text>
                    </Box>
                    <Box>
                        <Text color={selected === 'skip' ? theme.primary : theme.textMuted}>
                            {selected === 'skip' ? '▸ ' : '  '}Skip — continue without initializing
                        </Text>
                    </Box>
                </Box>
                <Box marginTop={1}>
                    <Text dimColor>
                        {chalk.hex(theme.textMuted)(`Project: ${projectDir}`)}
                    </Text>
                </Box>
            </Box>
        </Dialog>
    );
}

// ============================================================
// ContextCompletionDialog — 上下文补全对话框（OpenCode complete.go 风格）
// ============================================================

export type ContextSourceType = 'file' | 'directory' | 'symbol';

export interface ContextItem {
    type: ContextSourceType;
    label: string;
    path: string;
    detail?: string;
}

interface ContextCompletionDialogProps {
    width: number;
    cwd: string;
    onSelect: (item: ContextItem) => void;
    onClose: () => void;
}

function scanContextItems(cwd: string, query: string): ContextItem[] {
    const items: ContextItem[] = [];
    const lowerQuery = query.toLowerCase();
    const MAX = 20;

    try {
        const scanDir = (dir: string, prefix: string, depth: number): void => {
            if (depth > 3 || items.length >= MAX) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (items.length >= MAX) break;
                if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
                const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (!lowerQuery || rel.toLowerCase().includes(lowerQuery) || entry.name.toLowerCase().includes(lowerQuery)) {
                    if (entry.isDirectory()) {
                        items.push({ type: 'directory', label: rel + '/', path: path.join(dir, entry.name) });
                        scanDir(path.join(dir, entry.name), rel, depth + 1);
                    } else {
                        items.push({ type: 'file', label: rel, path: path.join(dir, entry.name) });
                    }
                }
            }
        };
        scanDir(cwd, '', 0);
    } catch { /* ignore */ }

    return items;
}

export function ContextCompletionDialog({
    width,
    cwd,
    onSelect,
    onClose,
}: ContextCompletionDialogProps): React.JSX.Element {
    const theme = getTheme();
    const styles = createThemedStyles(theme);
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);

    const items = useMemo(() => scanContextItems(cwd, query), [cwd, query]);
    const PAGE_SIZE = 10;
    const scrollOffset = Math.max(0, Math.min(selectedIndex - PAGE_SIZE + 1, items.length - PAGE_SIZE));
    const visible = items.slice(scrollOffset, scrollOffset + PAGE_SIZE);

    useInput((input, key) => {
        if (key.escape) { onClose(); return; }

        if (key.upArrow) {
            setSelectedIndex(prev => Math.max(0, prev - 1));
            return;
        }
        if (key.downArrow) {
            setSelectedIndex(prev => Math.min(items.length - 1, prev + 1));
            return;
        }
        if (key.return) {
            const item = items[selectedIndex];
            if (item) onSelect(item);
            return;
        }
        if (key.backspace || key.delete) {
            setQuery(prev => prev.slice(0, -1));
            setSelectedIndex(0);
            return;
        }
        if (input && !key.ctrl && !key.meta) {
            setQuery(prev => prev + input);
            setSelectedIndex(0);
        }
    });

    const iconMap: Record<ContextSourceType, string> = {
        file: '📄',
        directory: '📁',
        symbol: '🔣',
    };

    return (
        <Dialog width={width} title="Add Context" onClose={onClose}>
            <Box flexDirection="column" paddingX={1}>
                <Box>
                    <Text color={theme.textMuted}>Search: </Text>
                    <Text color={theme.text}>{query}<Text inverse> </Text></Text>
                </Box>
                <Box marginTop={1} flexDirection="column">
                    {visible.length === 0 ? (
                        <Text color={theme.textMuted}>No matches found</Text>
                    ) : (
                        visible.map((item, i) => {
                            const absIdx = scrollOffset + i;
                            const isSel = absIdx === selectedIndex;
                            return (
                                <Box key={item.path + item.type}>
                                    <Text>
                                        {isSel ? styles.accent('▸ ') : '  '}
                                        {iconMap[item.type]} {' '}
                                        {isSel
                                            ? chalk.hex(theme.textEmphasized).bold(item.label)
                                            : chalk.hex(theme.text)(item.label)}
                                        {item.detail ? chalk.hex(theme.textMuted)(` — ${item.detail}`) : ''}
                                    </Text>
                                </Box>
                            );
                        })
                    )}
                </Box>
                {items.length > PAGE_SIZE && (
                    <Box marginTop={1}>
                        <Text color={theme.textMuted}>{items.length} items total  ↑↓ select  Enter confirm  Esc cancel</Text>
                    </Box>
                )}
            </Box>
        </Dialog>
    );
}

// ============================================================
// ArgumentsDialog — 多参数输入对话框（OpenCode arguments.go 风格）
// ============================================================

export interface ArgumentField {
    name: string;
    label: string;
    placeholder?: string;
    required?: boolean;
    defaultValue?: string;
}

interface ArgumentsDialogProps {
    width: number;
    title: string;
    fields: ArgumentField[];
    onSubmit: (values: Record<string, string>) => void;
    onClose: () => void;
}

export function ArgumentsDialog({
    width,
    title,
    fields,
    onSubmit,
    onClose,
}: ArgumentsDialogProps): React.JSX.Element {
    const theme = getTheme();
    const [values, setValues] = useState<Record<string, string>>(() => {
        const init: Record<string, string> = {};
        for (const f of fields) init[f.name] = f.defaultValue ?? '';
        return init;
    });
    const [activeField, setActiveField] = useState(0);

    useInput((input, key) => {
        if (key.escape) { onClose(); return; }

        if (key.tab || key.downArrow) {
            setActiveField(prev => (prev + 1) % fields.length);
            return;
        }
        if (key.upArrow) {
            setActiveField(prev => prev > 0 ? prev - 1 : fields.length - 1);
            return;
        }

        if (key.return) {
            const missing = fields.filter(f => f.required && !values[f.name]?.trim());
            if (missing.length > 0) return;
            onSubmit(values);
            return;
        }

        const field = fields[activeField];
        if (!field) return;

        if (key.backspace || key.delete) {
            setValues(prev => ({ ...prev, [field.name]: prev[field.name]!.slice(0, -1) }));
            return;
        }

        if (input && !key.ctrl && !key.meta) {
            setValues(prev => ({ ...prev, [field.name]: prev[field.name]! + input }));
        }
    });

    return (
        <Dialog width={width} title={title} onClose={onClose}>
            <Box flexDirection="column" paddingX={1} paddingY={1}>
                {fields.map((field, i) => {
                    const isActive = i === activeField;
                    const value = values[field.name] ?? '';
                    const showPlaceholder = !value && field.placeholder;
                    return (
                        <Box key={field.name} flexDirection="column" marginBottom={1}>
                            <Text color={isActive ? theme.primary : theme.textMuted}>
                                {isActive ? '▸ ' : '  '}
                                {field.label}{field.required ? chalk.hex(theme.error)(' *') : ''}
                            </Text>
                            <Box paddingLeft={2}>
                                <Text>
                                    {isActive ? chalk.hex(theme.borderFocused)('│ ') : chalk.hex(theme.borderNormal)('│ ')}
                                    {showPlaceholder
                                        ? chalk.hex(theme.textMuted)(field.placeholder!)
                                        : chalk.hex(theme.text)(value)}
                                    {isActive && <Text inverse> </Text>}
                                </Text>
                            </Box>
                        </Box>
                    );
                })}
                <Box marginTop={1}>
                    <Text color={theme.textMuted}>Tab/↑↓ switch  Enter submit  Esc cancel</Text>
                </Box>
            </Box>
        </Dialog>
    );
}

/** 相对时间格式化 */
function formatRelativeTime(date: Date): string {
    const now = Date.now();
    const diff = now - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'now';
}
