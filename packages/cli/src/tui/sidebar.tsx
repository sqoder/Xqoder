// ============================================================
// 侧边栏组件 — 当前 Session 信息面板与被修改的文件 (复刻 OpenCode)
// 参考 OpenCode: components/chat/sidebar.go
// ============================================================

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import path from 'path';
import { getTheme } from './theme.js';
import type { FileChange } from './layout.js';

export interface ModifiedFileSummary {
    path: string;
    additions: number;
    removals: number;
    changeCount: number;
}

/** Sidebar 属性 */
interface SidebarProps {
    width: number;
    height: number;
    sessionTitle?: string;
    fileChanges?: FileChange[];
    cwd?: string;
}

function computeDiffStats(before: string | null, after: string | null) {
    if (before === null && after !== null) {
        return { additions: after.split('\n').filter(l => l.trim()).length, removals: 0 };
    }
    if (before !== null && after === null) {
        return { additions: 0, removals: before.split('\n').filter(l => l.trim()).length };
    }
    if (before === null || after === null) return { additions: 0, removals: 0 };

    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    let additions = 0;
    let removals = 0;

    const beforeSet = new Set(beforeLines);
    for (const l of afterLines) {
        if (!beforeSet.has(l)) additions++;
    }
    const afterSet = new Set(afterLines);
    for (const l of beforeLines) {
        if (!afterSet.has(l)) removals++;
    }

    return { additions, removals };
}

export function truncateSidebarPath(value: string, maxWidth: number): string {
    if (maxWidth <= 0) {
        return '';
    }

    if (value.length <= maxWidth) {
        return value;
    }

    if (maxWidth <= 3) {
        return '.'.repeat(maxWidth);
    }

    return `...${value.slice(-(maxWidth - 3))}`;
}

export function collectModifiedFiles(fileChanges: FileChange[], cwd = ''): ModifiedFileSummary[] {
    const summaries = new Map<string, { before: string | null; after: string | null; changeCount: number }>();

    for (const change of fileChanges) {
        const relativePath = cwd && change.filePath.startsWith(cwd)
            ? path.relative(cwd, change.filePath)
            : change.filePath;

        const previous = summaries.get(relativePath);
        summaries.set(relativePath, {
            before: previous ? previous.before : change.before,
            after: change.after,
            changeCount: (previous?.changeCount ?? 0) + 1,
        });
    }

    return Array.from(summaries.entries())
        .map(([filePath, snapshot]) => {
            const stats = computeDiffStats(snapshot.before, snapshot.after);
            return {
                path: filePath,
                additions: stats.additions,
                removals: stats.removals,
                changeCount: snapshot.changeCount,
            };
        })
        .filter((entry) => entry.additions > 0 || entry.removals > 0)
        .sort((left, right) => left.path.localeCompare(right.path));
}

export function Sidebar({
    width,
    height,
    sessionTitle,
    fileChanges = [],
    cwd = '',
}: SidebarProps): React.JSX.Element {
    const theme = getTheme();

    const modFiles = useMemo(() => collectModifiedFiles(fileChanges, cwd), [fileChanges, cwd]);

    const innerWidth = Math.max(8, width - 4);
    const maxVisibleFiles = Math.max(0, height - 8);

    return (
        <Box
            flexDirection="column"
            width={width}
            height={height}
            paddingLeft={2}
            paddingRight={1}
        >
            {/* Session Header */}
            <Box flexDirection="column">
                <Text bold color={theme.primary}>Session</Text>
                <Text>{truncateSidebarPath(sessionTitle ? sessionTitle : 'New Session', innerWidth)}</Text>
            </Box>

            <Box marginTop={1}>
                <Text bold color={theme.primary}>Modified Files</Text>
            </Box>

            {modFiles.length === 0 ? (
                <Box>
                    <Text color={theme.textMuted}>No modified files yet</Text>
                </Box>
            ) : (
                <Box flexDirection="column" marginTop={0}>
                    {modFiles.slice(0, maxVisibleFiles).map(file => {
                        const maxPathWidth = innerWidth - 8;
                        const displayPath = truncateSidebarPath(file.path, maxPathWidth);

                        return (
                            <Box key={file.path} flexDirection="column" width={innerWidth}>
                                <Text>{displayPath}</Text>
                                <Text color={theme.textMuted}>
                                    {file.additions > 0 ? `+${file.additions} ` : ''}
                                    {file.removals > 0 ? `-${file.removals} ` : ''}
                                    ({file.changeCount} change{file.changeCount === 1 ? '' : 's'})
                                </Text>
                            </Box>
                        );
                    })}
                    {modFiles.length > maxVisibleFiles && (
                        <Box>
                            <Text color={theme.textMuted}>... and {modFiles.length - maxVisibleFiles} more</Text>
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
}

// 供其它文件引用以不报缺少 SessionInfo 错误
export interface SessionInfo {
    id: string;
    title: string;
    updatedAt: Date;
    messageCount: number;
    isActive?: boolean;
}
