// ============================================================
// 布局组件 — ChatPage 主布局 + StatusBar
// 参考 OpenCode: tui/layout/split.go
// ============================================================

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import type { TuiMouseMode } from '@xqoder/shared';
import { getTheme } from './theme.js';
import { MessageList, type ChatMessage } from './message.js';
import {
    Editor,
    CompletionDropdown,
    getCompletionDropdownHeight,
    measureEditorRows,
    type CompletionState,
} from './editor.js';
import { Sidebar, type SessionInfo } from './sidebar.js';
import type { SlashCommandDef } from './commands.js';
import type { TimelineEntry, TimelineSection } from './timeline.js';
import { buildVisibleTimelineSections } from './timeline.js';
import type { SidePanelType } from './types.js';

// ============================================================
// Token 用量显示
// ============================================================

export interface SessionUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
}

/** 每千 token 价格表（美元），按 provider/model 前缀匹配 */
const COST_PER_1K: Record<string, { input: number; output: number }> = {
    'claude-opus': { input: 0.015, output: 0.075 },
    'claude-sonnet': { input: 0.003, output: 0.015 },
    'claude-haiku': { input: 0.00025, output: 0.00125 },
    'gpt-4o': { input: 0.005, output: 0.015 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-3.5': { input: 0.0005, output: 0.0015 },
    'gemini-2.0-flash': { input: 0.000075, output: 0.0003 },
    'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
    'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
    'qwen-max': { input: 0.0016, output: 0.0016 },
    'qwen-plus': { input: 0.0004, output: 0.0012 },
    'qwen-turbo': { input: 0.0002, output: 0.0006 },
    'deepseek': { input: 0.00014, output: 0.00028 },
};

function estimateCost(model: string, usage: SessionUsage): number {
    const key = Object.keys(COST_PER_1K).find(k => model.toLowerCase().includes(k));
    if (!key) return 0;
    const rate = COST_PER_1K[key]!;
    return (usage.promptTokens / 1000) * rate.input + (usage.completionTokens / 1000) * rate.output;
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

function formatCost(usd: number): string {
    if (usd === 0) return '';
    if (usd < 0.001) return `<$0.001`;
    return `$${usd.toFixed(3)}`;
}

// ============================================================
// 旧版 SplitLayout（保留兼容性）
// ============================================================

export interface PanelConfig {
    id: string;
    minWidth?: number;
    maxWidth?: number;
    defaultWidth?: number;
}

interface SplitLayoutProps {
    width: number;
    height: number;
    leftPanel: React.ReactNode;
    rightPanel: React.ReactNode;
    bottomPanel?: React.ReactNode;
    leftPanelWidth?: number;
    bottomPanelHeight?: number;
    showLeftPanel?: boolean;
    showBottomPanel?: boolean;
}

export function SplitLayout({
    width,
    height,
    leftPanel,
    rightPanel,
    bottomPanel,
    leftPanelWidth = 25,
    bottomPanelHeight = 8,
    showLeftPanel = true,
    showBottomPanel = false,
}: SplitLayoutProps): React.JSX.Element {
    const theme = getTheme();

    const effectiveBottomHeight = showBottomPanel && bottomPanel ? bottomPanelHeight : 0;
    const mainHeight = height - effectiveBottomHeight;
    const leftWidth = showLeftPanel ? Math.floor(width * leftPanelWidth / 100) : 0;
    const rightWidth = width - leftWidth;

    return (
        <Box flexDirection="column" width={width} height={height}>
            <Box width={width} height={mainHeight}>
                {showLeftPanel && (
                    <Box
                        width={leftWidth}
                        height={mainHeight}
                        borderStyle="single"
                        borderColor={theme.borderNormal}
                        flexDirection="column"
                    >
                        {leftPanel}
                    </Box>
                )}
                <Box width={rightWidth} height={mainHeight} flexDirection="column">
                    {rightPanel}
                </Box>
            </Box>

            {showBottomPanel && bottomPanel && (
                <Box
                    width={width}
                    height={effectiveBottomHeight}
                    borderStyle="single"
                    borderColor={theme.borderNormal}
                    flexDirection="column"
                >
                    {bottomPanel}
                </Box>
            )}
        </Box>
    );
}

// ============================================================
// 旧版 PageManager（保留兼容性）
// ============================================================

export type PageType = 'chat' | 'logs' | 'settings';

interface PageManagerProps {
    currentPage: PageType;
    children: Record<PageType, React.ReactNode>;
    width: number;
    height: number;
}

export function PageManager({
    currentPage,
    children,
    width,
    height,
}: PageManagerProps): React.JSX.Element {
    const theme = getTheme();

    return (
        <Box flexDirection="column" width={width} height={height}>
            <Box height={1} width={width}>
                {(Object.keys(children) as PageType[]).map((page, idx) => {
                    const isActive = page === currentPage;
                    const label = page.charAt(0).toUpperCase() + page.slice(1);
                    return (
                        <Box key={page} paddingX={1}>
                            <Text
                                bold={isActive}
                                color={isActive ? theme.primary : theme.textMuted}
                                underline={isActive}
                            >
                                {`${idx + 1}:${label}`}
                            </Text>
                        </Box>
                    );
                })}
            </Box>

            <Box width={width} height={height - 1} flexDirection="column">
                {children[currentPage]}
            </Box>
        </Box>
    );
}

// ============================================================
// StatusBar — 底部信息栏
// ============================================================

export interface DiagnosticCounts {
    errors: number;
    warnings: number;
    hints: number;
}

interface StatusBarProps {
    width: number;
    model: string;
    agent?: string;
    provider?: string;
    mouseMode?: TuiMouseMode;
    usage?: SessionUsage;
    sessionId?: string;
    page?: string;
    infoMessage?: string;
    contextWindow?: number;
    diagnostics?: DiagnosticCounts;
    sessionCost?: number;
    statusBadges?: string[];
}

export function buildStatusBadges(options: {
    activeCommand?: string;
    visibleSidePanels?: SidePanelType[];
    toolExecutionCount?: number;
    fileChangeCount?: number;
    diffSelectedIndex?: number;
    timelineCount?: number;
    timelineSelectedIndex?: number;
}): string[] {
    const badges: string[] = [];
    const visibleSidePanels = options.visibleSidePanels ?? [];
    if (options.activeCommand) {
        badges.push(`run:${options.activeCommand}`);
    }
    if (visibleSidePanels.includes('tool')) {
        badges.push(`details:${options.toolExecutionCount ?? 0}`);
    }
    if (visibleSidePanels.includes('diff')) {
        const count = options.fileChangeCount ?? 0;
        const selected = count > 0 ? (options.diffSelectedIndex ?? 0) + 1 : 0;
        badges.push(count > 0 ? `diff:${selected}/${count}` : 'diff:empty');
    }
    if (visibleSidePanels.includes('timeline')) {
        const count = options.timelineCount ?? 0;
        const selected = count > 0 ? (options.timelineSelectedIndex ?? 0) + 1 : 0;
        badges.push(count > 0 ? `timeline:${selected}/${count}` : 'timeline:empty');
    }
    return badges;
}

export function StatusBar({
    width,
    model,
    agent,
    usage,
    infoMessage,
    contextWindow,
    sessionCost,
    statusBadges = [],
}: StatusBarProps): React.JSX.Element {
    const theme = getTheme();
    const totalTokens = usage ? usage.promptTokens + usage.completionTokens : 0;
    const promptTokens = usage?.promptTokens ?? 0;
    const cost = sessionCost ?? (usage ? estimateCost(model, usage) : 0);

    const parts: string[] = [];
    if (agent && agent !== 'general') parts.push(chalk.hex(theme.accent)(agent));
    parts.push(chalk.hex(theme.textMuted)(model));
    if (contextWindow && promptTokens > 0) {
        const pct = Math.round((promptTokens / contextWindow) * 100);
        const color = pct >= 80 ? theme.error : pct >= 60 ? theme.warning : theme.textMuted;
        parts.push(chalk.hex(color)(`${formatTokens(promptTokens)}/${formatTokens(contextWindow)}`));
    } else if (totalTokens > 0) {
        parts.push(chalk.hex(theme.textMuted)(`${formatTokens(totalTokens)} tokens`));
    }
    if (cost > 0) parts.push(chalk.hex(theme.textMuted)(formatCost(cost)));

    const rightParts = [
        parts.join(chalk.hex(theme.borderDim)(' · ')),
        statusBadges.length > 0 ? chalk.hex(theme.borderDim)(statusBadges.join(' ')) : '',
        chalk.hex(theme.borderDim)('ctrl+k commands  ctrl+s sessions  ctrl+l logs'),
    ].filter(Boolean);
    const right = rightParts.join('   ');
    const infoStr = infoMessage
        ? chalk.hex(theme.textMuted)(infoMessage.slice(0, Math.max(10, width - 40)))
        : '';

    return (
        <Box height={1} width={width}>
            <Box flexGrow={1}>
                <Text> {chalk.hex(theme.textMuted)('xqoder')} {infoStr}</Text>
            </Box>
            <Text>{right} </Text>
        </Box>
    );
}

// ============================================================
// Tool Execution 日志类型 & 面板
// ============================================================

export interface ToolExecution {
    id: string;
    name: string;
    args: Record<string, unknown>;
    startedAt: Date;
    endedAt?: Date;
    success?: boolean;
    output?: string;
}

interface ToolDetailsPanelProps {
    executions: ToolExecution[];
    width: number;
    height: number;
    selectedIndex: number;
    expandedToolIds: string[];
    isFocused: boolean;
}

function ToolDetailsPanel({ executions, width, height, selectedIndex, expandedToolIds, isFocused }: ToolDetailsPanelProps): React.JSX.Element {
    const theme = getTheme();
    const maxItems = Math.max(1, height - 3);
    const visible = executions.slice(-maxItems);

    return (
        <Box
            flexDirection="column"
            width={width}
            height={height}
            borderStyle="single"
            borderColor={theme.borderNormal}
        >
            <Box paddingX={1} justifyContent="space-between">
                <Box>
                    <Text bold color={theme.accent}>Tool Executions</Text>
                    <Text color={theme.textMuted}> ({executions.length})</Text>
                </Box>
                <Text color={isFocused ? theme.accent : theme.textMuted}>{isFocused ? 'focus:details' : 'panel:details'}</Text>
            </Box>
            {visible.length === 0 ? (
                <Box paddingX={1}><Text color={theme.textMuted}>No tool calls yet</Text></Box>
            ) : (
                visible.map((exec, index) => {
                    const originalIndex = Math.max(0, executions.length - visible.length) + index;
                    const isSelected = originalIndex === selectedIndex;
                    const isExpanded = expandedToolIds.includes(exec.id);
                    const icon = exec.endedAt == null ? '⏳' : exec.success ? '✓' : '✗';
                    const iconColor = exec.endedAt == null ? theme.warning : exec.success ? theme.success : theme.error;
                    const elapsed = exec.endedAt
                        ? `${((exec.endedAt.getTime() - exec.startedAt.getTime()) / 1000).toFixed(1)}s`
                        : '...';
                    const argsStr = Object.keys(exec.args).length > 0
                        ? JSON.stringify(exec.args).slice(0, Math.max(20, width - exec.name.length - 20))
                        : '';
                    const outputPreview = exec.output?.slice(0, Math.max(20, width - 6));
                    return (
                        <Box key={exec.id} paddingX={1} flexDirection="column">
                            <Box flexDirection="row" justifyContent="space-between">
                                <Box flexDirection="row">
                                    <Text color={iconColor}>{isSelected ? '›' : icon} </Text>
                                    <Text bold color={isSelected ? theme.accent : theme.text}>{exec.name}</Text>
                                    <Text color={theme.textMuted}> {elapsed}</Text>
                                    {argsStr && <Text color={theme.textMuted}> {argsStr}</Text>}
                                </Box>
                                <Text color={theme.textMuted}>{isExpanded ? 'expanded' : 'collapsed'}</Text>
                            </Box>
                            {isExpanded && outputPreview && (
                                <Text color={theme.textMuted}>output: {outputPreview}</Text>
                            )}
                        </Box>
                    );
                })
            )}
        </Box>
    );
}

export interface TimelinePanelProps {
    sections: TimelineSection[];
    entries: TimelineEntry[];
    expandedIds: string[];
    selectedIndex: number;
    width: number;
    height: number;
    isFocused: boolean;
}

export function TimelinePanel({ sections, entries, expandedIds, selectedIndex, width, height, isFocused }: TimelinePanelProps): React.JSX.Element {
    const theme = getTheme();
    const maxItems = Math.max(1, height - 2);
    const visible = entries.slice(0, maxItems);

    return (
        <Box flexDirection="column" width={width} height={height} borderStyle="single" borderColor={theme.borderNormal}>
            <Box paddingX={1} justifyContent="space-between">
                <Text bold color={theme.accent}>Timeline</Text>
                <Text color={isFocused ? theme.accent : theme.textMuted}>{entries.length === 0 ? 'empty' : `[${Math.min(selectedIndex + 1, entries.length)}/${entries.length}]`}</Text>
            </Box>
            {visible.length === 0 ? (
                <Box paddingX={1}><Text color={theme.textMuted}>No timeline events yet</Text></Box>
            ) : (
                sections.map((section) => (
                    <Box key={section.title} flexDirection="column">
                        <Box paddingX={1}>
                            <Text bold color={theme.textMuted}>{section.title}</Text>
                        </Box>
                        {section.entries.slice(0, maxItems).map((entry) => {
                            const index = entries.findIndex((candidate) => candidate.id === entry.id);
                            const isSelected = index === selectedIndex;
                            const isExpanded = expandedIds.includes(entry.id);
                            const marker = isSelected ? '›' : ' ';
                            const kind = `[${entry.kind}]`;
                            return (
                                <Box key={entry.id} paddingX={1} flexDirection="column">
                                    <Text color={isSelected ? theme.accent : theme.text}>
                                        {marker} {kind} {entry.title}
                                    </Text>
                                    <Text color={theme.textMuted}>{entry.summary.slice(0, Math.max(20, width - 6))}</Text>
                                    {isExpanded && entry.detail && (
                                        <Text color={theme.textMuted}>{entry.detail.slice(0, Math.max(20, (width - 4) * 2))}</Text>
                                    )}
                                </Box>
                            );
                        })}
                    </Box>
                ))
            )}
        </Box>
    );
}

// ============================================================
// FileChange & DiffPanel — 文件变更追踪与 diff 显示
// ============================================================

export interface FileChange {
    filePath: string;
    before: string | null;
    after: string | null;
    toolName: string;
    timestamp: Date;
}

function computeSimpleDiff(before: string | null, after: string | null, contextLines = 2): { type: 'add' | 'remove' | 'context'; text: string }[] {
    if (before === null && after !== null) {
        return after.split('\n').map(line => ({ type: 'add' as const, text: line }));
    }
    if (before !== null && after === null) {
        return before.split('\n').map(line => ({ type: 'remove' as const, text: line }));
    }
    if (before === null || after === null) return [];

    const oldLines = before.split('\n');
    const newLines = after.split('\n');
    const result: { type: 'add' | 'remove' | 'context'; text: string }[] = [];

    const maxLen = Math.max(oldLines.length, newLines.length);
    let i = 0;
    while (i < maxLen) {
        const oldLine = i < oldLines.length ? oldLines[i] : undefined;
        const newLine = i < newLines.length ? newLines[i] : undefined;
        if (oldLine === newLine) {
            result.push({ type: 'context', text: oldLine ?? '' });
        } else {
            if (oldLine !== undefined) result.push({ type: 'remove', text: oldLine });
            if (newLine !== undefined) result.push({ type: 'add', text: newLine });
        }
        i++;
    }

    const filtered: typeof result = [];
    for (let j = 0; j < result.length; j++) {
        if (result[j]!.type !== 'context') {
            const start = Math.max(0, j - contextLines);
            const end = Math.min(result.length - 1, j + contextLines);
            for (let k = start; k <= end; k++) {
                if (!filtered.includes(result[k]!)) filtered.push(result[k]!);
            }
        }
    }
    return filtered.length > 0 ? filtered : result.slice(0, 10);
}

interface DiffPanelProps {
    changes: FileChange[];
    width: number;
    height: number;
    selectedIndex: number;
    isFocused: boolean;
}

export function DiffPanel({ changes, width, height, selectedIndex, isFocused }: DiffPanelProps): React.JSX.Element {
    const theme = getTheme();

    if (changes.length === 0) {
        return (
            <Box flexDirection="column" width={width} height={height} borderStyle="single" borderColor={theme.borderNormal}>
                <Box paddingX={1}><Text bold color={theme.accent}>Diff Viewer</Text></Box>
                <Box paddingX={1}><Text color={theme.textMuted}>No file changes yet</Text></Box>
            </Box>
        );
    }

    const change = changes[Math.min(selectedIndex, changes.length - 1)];
    if (!change) {
        return (
            <Box flexDirection="column" width={width} height={height} borderStyle="single" borderColor={theme.borderNormal}>
                <Box paddingX={1}><Text color={theme.textMuted}>No changes</Text></Box>
            </Box>
        );
    }

    const diffLines = computeSimpleDiff(change.before, change.after);
    const maxDiffLines = Math.max(1, height - 4);
    const visible = diffLines.slice(0, maxDiffLines);

    return (
        <Box flexDirection="column" width={width} height={height} borderStyle="single" borderColor={theme.borderNormal}>
            <Box paddingX={1} justifyContent="space-between">
                <Text bold color={theme.accent}>Diff: {change.filePath.split('/').pop()}</Text>
                <Text color={isFocused ? theme.accent : theme.textMuted}>selected [{selectedIndex + 1}/{changes.length}]</Text>
            </Box>
            <Box paddingX={1} justifyContent="space-between">
                <Text color={theme.textMuted}>{change.filePath} ({change.toolName})</Text>
                <Text color={theme.textMuted}>source: timeline ↔ diff</Text>
            </Box>
            {visible.map((line, i) => {
                const color = line.type === 'add' ? theme.success
                    : line.type === 'remove' ? theme.error
                        : theme.textMuted;
                const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
                const displayText = `${prefix} ${line.text}`.slice(0, width - 4);
                return (
                    <Box key={i} paddingX={1}>
                        <Text color={color}>{displayText}</Text>
                    </Box>
                );
            })}
            {diffLines.length > maxDiffLines && (
                <Box paddingX={1}>
                    <Text color={theme.textMuted}>... {diffLines.length - maxDiffLines} more lines</Text>
                </Box>
            )}
        </Box>
    );
}

// ============================================================
// ChatPage — Claude Code 风格全宽聊天布局
// ============================================================

interface ChatPageProps {
    width: number;
    height: number;
    messages: ChatMessage[];
    editorValue: string;
    onEditorChange: (value: string) => void;
    onEditorSubmit: (value: string) => void;
    sessions: SessionInfo[];
    currentSessionId?: string;
    onSelectSession: (id: string) => void;
    onNewSession: () => void;
    model: string;
    agent?: string;
    provider?: string;
    usage?: SessionUsage;
    infoMessage?: string;
    mouseMode?: TuiMouseMode;
    mouseScrollStep?: number;
    onTranscriptAutoFollowChange?: (autoFollow: boolean) => void;
    onTranscriptSelectionCopied?: (success: boolean) => void;
    editorAttachments?: string[];
    onRemoveAttachment?: (index: number) => void;
    onClearAttachments?: () => void;
    isDialogOpen?: boolean;
    cwd?: string;
    slashCommands?: SlashCommandDef[];
    toolExecutions?: ToolExecution[];
    visibleSidePanels?: SidePanelType[];
    selectedToolExecutionIndex?: number;
    expandedToolIds?: string[];
    fileChanges?: FileChange[];
    diffSelectedIndex?: number;
    timelineEntries?: TimelineEntry[];
    timelineExpandedIds?: string[];
    timelineSelectedIndex?: number;
    focusedSidePanel?: SidePanelType;
    activeCommand?: string;
    contextWindow?: number;
    sessionCost?: number;
    onCursorOverrideConsumed?: () => void;
    /** 终端坐标锚点：传入时同步终端光标到输入行，使拼音候选栏与输入框对齐 */
    terminalCursorAnchor?: { x: number; y: number } | null;
}

/**
 * ChatPage — full-width, no sidebar, Claude Code style.
 *
 * Layout (top → bottom):
 *   messages area  (fills remaining space)
 *   ─── thin separator ───
 *   editor (OpenCode-style bottom textarea, auto-sized up to 4 rows)
 *   status bar (1 line)
 */
const MIN_EDITOR_CONTENT_ROWS = 1;
const MAX_EDITOR_CONTENT_ROWS = 4;
const EDITOR_SEPARATOR_HEIGHT = 1;

export type SidePanelKind = 'tool' | 'diff' | 'timeline' | null;

interface ChatShellMetrics {
    mainColumnWidth: number;
    sideColumnWidth: number;
    transcriptHeight: number;
    editorBoxHeight: number;
    completionHeight: number;
    mainContentHeight: number;
    sidebarHeight: number;
    panelHeight: number;
}

export function resolveSidePanelKind(options: {
    focusedSidePanel?: SidePanelType;
    visibleSidePanels?: SidePanelType[];
}): SidePanelKind {
    const visibleSidePanels = options.visibleSidePanels ?? [];
    const orderedCandidates: SidePanelKind[] = [
        options.focusedSidePanel ?? null,
        'timeline',
        'diff',
        'tool',
    ];

    for (const candidate of orderedCandidates) {
        if (candidate === 'timeline' && visibleSidePanels.includes('timeline')) {
            return candidate;
        }
        if (candidate === 'diff' && visibleSidePanels.includes('diff')) {
            return candidate;
        }
        if (candidate === 'tool' && visibleSidePanels.includes('tool')) {
            return candidate;
        }
    }

    return null;
}

export function buildChatShellMetrics(options: {
    width: number;
    height: number;
    showSidebar: boolean;
    sidePanelKind: SidePanelKind;
    completionHeight: number;
    editorBoxHeight: number;
}): ChatShellMetrics {
    const mainContentHeight = Math.max(6, options.height - 1);
    const showSideColumn = options.showSidebar || options.sidePanelKind !== null;
    const desiredSideWidth = Math.max(28, Math.min(42, Math.floor(options.width * 0.3)));
    const maxSideWidth = Math.max(0, options.width - 56);
    const sideColumnWidth = showSideColumn
        ? Math.max(24, Math.min(desiredSideWidth, maxSideWidth || desiredSideWidth))
        : 0;
    const mainColumnWidth = Math.max(24, options.width - sideColumnWidth);
    const editorSectionHeight = options.editorBoxHeight + options.completionHeight;
    const transcriptHeight = Math.max(3, mainContentHeight - editorSectionHeight);

    if (!showSideColumn) {
        return {
            mainColumnWidth,
            sideColumnWidth: 0,
            transcriptHeight,
            editorBoxHeight: options.editorBoxHeight,
            completionHeight: options.completionHeight,
            mainContentHeight,
            sidebarHeight: 0,
            panelHeight: 0,
        };
    }

    if (options.showSidebar && options.sidePanelKind) {
        const sidebarHeight = Math.max(10, Math.min(mainContentHeight - 8, Math.floor(mainContentHeight * 0.4)));
        return {
            mainColumnWidth,
            sideColumnWidth,
            transcriptHeight,
            editorBoxHeight: options.editorBoxHeight,
            completionHeight: options.completionHeight,
            mainContentHeight,
            sidebarHeight,
            panelHeight: Math.max(8, mainContentHeight - sidebarHeight - 1),
        };
    }

    return {
        mainColumnWidth,
        sideColumnWidth,
        transcriptHeight,
        editorBoxHeight: options.editorBoxHeight,
        completionHeight: options.completionHeight,
        mainContentHeight,
        sidebarHeight: options.showSidebar ? mainContentHeight : 0,
        panelHeight: options.sidePanelKind ? mainContentHeight : 0,
    };
}

function renderSidePanel(params: {
    kind: SidePanelKind;
    width: number;
    height: number;
    toolExecutions: ToolExecution[];
    selectedToolExecutionIndex: number;
    expandedToolIds: string[];
    fileChanges: FileChange[];
    diffSelectedIndex: number;
    timelineSections: TimelineSection[];
    timelineEntries: TimelineEntry[];
    timelineExpandedIds: string[];
    timelineSelectedIndex: number;
    activePanel: 'tool' | 'diff' | 'timeline';
}): React.JSX.Element | null {
    if (params.kind === 'tool') {
        return (
            <ToolDetailsPanel
                executions={params.toolExecutions}
                width={params.width}
                height={params.height}
                selectedIndex={params.selectedToolExecutionIndex}
                expandedToolIds={params.expandedToolIds}
                isFocused={params.activePanel === 'tool'}
            />
        );
    }

    if (params.kind === 'diff') {
        return (
            <DiffPanel
                changes={params.fileChanges}
                width={params.width}
                height={params.height}
                selectedIndex={params.diffSelectedIndex}
                isFocused={params.activePanel === 'diff'}
            />
        );
    }

    if (params.kind === 'timeline') {
        return (
            <TimelinePanel
                sections={params.timelineSections}
                entries={params.timelineEntries}
                expandedIds={params.timelineExpandedIds}
                selectedIndex={params.timelineSelectedIndex}
                width={params.width}
                height={params.height}
                isFocused={params.activePanel === 'timeline'}
            />
        );
    }

    return null;
}

function truncateMiddle(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    const keep = Math.max(4, Math.floor((maxLength - 1) / 2));
    return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

function WorkspaceSidebarPanel(props: {
    width: number;
    height: number;
    sessionTitle?: string;
    fileChanges: FileChange[];
    cwd?: string;
}): React.JSX.Element {
    const theme = getTheme();
    const headerWidth = Math.max(12, props.width - 4);
    const bodyHeight = Math.max(4, props.height - 4);
    const cwdLabel = props.cwd
        ? truncateMiddle(props.cwd, Math.max(16, headerWidth))
        : 'cwd unavailable';

    return (
        <Box flexDirection="column" width={props.width} height={props.height} borderStyle="single" borderColor={theme.borderDim}>
            <Box flexDirection="column" paddingX={1}>
                <Text bold color={theme.accent}>XQoder</Text>
                <Text color={theme.textMuted}>{cwdLabel}</Text>
            </Box>
            <Sidebar
                width={Math.max(8, props.width - 2)}
                height={bodyHeight}
                sessionTitle={props.sessionTitle}
                fileChanges={props.fileChanges}
                cwd={props.cwd}
            />
        </Box>
    );
}

export function ChatPage({
    width,
    height,
    messages,
    editorValue,
    onEditorChange,
    onEditorSubmit,
    sessions,

    model,
    agent,
    usage,
    infoMessage,
    mouseMode = 'terminal',
    mouseScrollStep = 3,
    onTranscriptAutoFollowChange,
    onTranscriptSelectionCopied,
    editorAttachments = [],
    onRemoveAttachment,
    onClearAttachments,
    isDialogOpen = false,
    cwd,
    slashCommands = [],
    toolExecutions = [],
    visibleSidePanels = [],
    selectedToolExecutionIndex = 0,
    expandedToolIds = [],
    fileChanges = [],
    diffSelectedIndex = 0,
    timelineEntries = [],
    timelineExpandedIds = [],
    timelineSelectedIndex = 0,
    focusedSidePanel = 'timeline',
    activeCommand,
    contextWindow,
    sessionCost,
    currentSessionId,
}: ChatPageProps): React.JSX.Element {
    const theme = getTheme();
    const [completion, setCompletion] = useState<CompletionState | null>(null);
    const dropdownHeight = completion ? getCompletionDropdownHeight(completion) : 0;
    const showToolDetails = visibleSidePanels.includes('tool');
    const showDiff = visibleSidePanels.includes('diff');
    const showTimeline = visibleSidePanels.includes('timeline');
    const statusBadges = buildStatusBadges({
        activeCommand,
        visibleSidePanels,
        toolExecutionCount: toolExecutions.length,
        fileChangeCount: fileChanges.length,
        diffSelectedIndex,
        timelineCount: timelineEntries.length,
        timelineSelectedIndex,
    });
    const sidePanelKind = resolveSidePanelKind({
        focusedSidePanel,
        visibleSidePanels,
    });
    const showSidebar = Boolean(currentSessionId);
    const preliminaryMetrics = buildChatShellMetrics({
        width,
        height,
        showSidebar,
        sidePanelKind,
        completionHeight: dropdownHeight,
        editorBoxHeight: MIN_EDITOR_CONTENT_ROWS + EDITOR_SEPARATOR_HEIGHT,
    });
    const editorContentWidth = Math.max(10, preliminaryMetrics.mainColumnWidth - 2);
    const editorInputRows = Math.max(
        MIN_EDITOR_CONTENT_ROWS,
        Math.min(MAX_EDITOR_CONTENT_ROWS, measureEditorRows(editorValue, editorContentWidth)),
    );
    const editorAttachmentRows = editorAttachments.length > 0 ? 1 : 0;
    const editorBoxHeight = EDITOR_SEPARATOR_HEIGHT + editorAttachmentRows + editorInputRows;
    const metrics = buildChatShellMetrics({
        width,
        height,
        showSidebar,
        sidePanelKind,
        completionHeight: dropdownHeight,
        editorBoxHeight,
    });
    const timelineSections = buildVisibleTimelineSections(
        timelineEntries,
        Math.max(1, (metrics.panelHeight || metrics.mainContentHeight) - 2),
    );
    const sidePanel = renderSidePanel({
        kind: sidePanelKind,
        width: metrics.sideColumnWidth,
        height: metrics.panelHeight,
        toolExecutions,
        selectedToolExecutionIndex,
        expandedToolIds,
        fileChanges,
        diffSelectedIndex,
        timelineSections,
        timelineEntries,
        timelineExpandedIds,
        timelineSelectedIndex,
        activePanel: focusedSidePanel,
    });

    return (
        <Box flexDirection="column" width={width} height={height}>
            <Box flexDirection="row" width={width} height={metrics.mainContentHeight}>
                <Box flexDirection="column" width={metrics.mainColumnWidth} height={metrics.mainContentHeight}>
                    <Box width={metrics.mainColumnWidth} height={metrics.transcriptHeight}>
                        <MessageList
                            messages={messages}
                            width={metrics.mainColumnWidth}
                            height={metrics.transcriptHeight}
                            isActive={!isDialogOpen}
                            mouseMode={mouseMode}
                            mouseScrollStep={mouseScrollStep}
                            arrowScrollEnabled={editorValue.trim() === '' && !completion}
                            onAutoFollowChange={onTranscriptAutoFollowChange}
                            onSelectionCopied={onTranscriptSelectionCopied}
                        />
                    </Box>

                    {completion && (
                        <Box width={metrics.mainColumnWidth} height={metrics.completionHeight}>
                            <CompletionDropdown
                                completion={completion}
                                width={metrics.mainColumnWidth}
                                slashCommands={slashCommands}
                            />
                        </Box>
                    )}

                    <Box width={metrics.mainColumnWidth} height={metrics.editorBoxHeight} flexDirection="column">
                        <Text color={theme.borderDim}>{'─'.repeat(Math.max(1, metrics.mainColumnWidth))}</Text>
                        <Box paddingLeft={1} height={metrics.editorBoxHeight - EDITOR_SEPARATOR_HEIGHT}>
                            <Editor
                                value={editorValue}
                                onChange={onEditorChange}
                                onSubmit={onEditorSubmit}
                                width={editorContentWidth}
                                maxHeight={editorInputRows}
                                attachments={editorAttachments}
                                onRemoveAttachment={onRemoveAttachment}
                                onClearAttachments={onClearAttachments}
                                cwd={cwd}
                                slashCommands={slashCommands}
                                completion={completion}
                                onCompletionChange={setCompletion}
                                isActive={!isDialogOpen}
                            />
                        </Box>
                    </Box>
                </Box>

                {metrics.sideColumnWidth > 0 && (
                    <Box flexDirection="column" width={metrics.sideColumnWidth} height={metrics.mainContentHeight} paddingLeft={1}>
                        {showSidebar && metrics.sidebarHeight > 0 && (
                            <WorkspaceSidebarPanel
                                width={metrics.sideColumnWidth}
                                height={metrics.sidebarHeight}
                                sessionTitle={sessions.find((session) => session.id === currentSessionId)?.title}
                                fileChanges={fileChanges}
                                cwd={cwd}
                            />
                        )}

                        {sidePanel && metrics.panelHeight > 0 && (
                            <Box marginTop={showSidebar && metrics.sidebarHeight > 0 ? 1 : 0}>
                                {sidePanel}
                            </Box>
                        )}
                    </Box>
                )}
            </Box>

            {/* Status bar — Moved to bottom to avoid cursor sync interference */}
            <Box width={width} height={1}>
                <StatusBar
                    width={width}
                    model={model}
                    agent={agent}
                    usage={usage}
                    sessionId={currentSessionId}
                    infoMessage={infoMessage}
                    contextWindow={contextWindow}
                    sessionCost={sessionCost}
                    statusBadges={statusBadges}
                />
            </Box>
        </Box>
    );
}
