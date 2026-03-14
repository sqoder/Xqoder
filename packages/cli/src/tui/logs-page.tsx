// ============================================================
// LogsPage — 结构化日志查看页面
// 参考 OpenCode: internal/tui/page/logs.go
// ============================================================

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import { getTheme, createThemedStyles, themeColor } from './theme.js';
import { ICONS } from './icons.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

export interface LogEntry {
    id: string;
    timestamp: Date;
    level: LogLevel;
    message: string;
    source?: string;
    attributes?: Record<string, unknown>;
}

interface LogsPageProps {
    logs: LogEntry[];
    width: number;
    height: number;
    isActive?: boolean;
    onClose?: () => void;
}

/**
 * Convert raw console log strings into structured LogEntry objects.
 */
export function logsFromStrings(lines: string[]): LogEntry[] {
    return lines.map((line, i) => {
        let level: LogLevel = 'info';
        if (line.includes('[ERROR]') || line.includes('error')) level = 'error';
        else if (line.includes('[WARN]') || line.includes('warn')) level = 'warn';
        else if (line.includes('[DEBUG]') || line.includes('debug')) level = 'debug';
        else if (line.includes('[SUCCESS]') || line.includes('✓')) level = 'success';

        const sourceMatch = line.match(/\[([A-Za-z]+)\]/);
        return {
            id: `log_${i}`,
            timestamp: new Date(),
            level,
            message: line,
            source: sourceMatch?.[1],
        };
    });
}

const LEVEL_ICONS: Record<LogLevel, string> = {
    debug: ICONS.ellipsis,
    info: ICONS.info,
    warn: ICONS.warning,
    error: ICONS.cross,
    success: ICONS.check,
};

export function LogsPage({ logs, width, height, isActive = true, onClose }: LogsPageProps): React.JSX.Element {
    const theme = getTheme();
    const styles = createThemedStyles(theme);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [filterLevel, setFilterLevel] = useState<LogLevel | 'all'>('all');
    const [showDetails, setShowDetails] = useState(false);

    const filtered = useMemo(() => {
        if (filterLevel === 'all') return logs;
        return logs.filter(l => l.level === filterLevel);
    }, [logs, filterLevel]);

    const listHeight = showDetails ? Math.floor(height * 0.5) : height - 3;
    const scrollOffset = Math.max(0, Math.min(selectedIndex - listHeight + 3, filtered.length - listHeight));
    const visible = filtered.slice(scrollOffset, scrollOffset + listHeight);
    const selected = filtered[selectedIndex];

    useInput((input, key) => {
        if (key.escape) { onClose?.(); return; }
        if (key.upArrow) { setSelectedIndex(prev => Math.max(0, prev - 1)); return; }
        if (key.downArrow) { setSelectedIndex(prev => Math.min(filtered.length - 1, prev + 1)); return; }
        if (key.return) { setShowDetails(prev => !prev); return; }
        if (input === 'd') { setFilterLevel('debug'); setSelectedIndex(0); return; }
        if (input === 'i') { setFilterLevel('info'); setSelectedIndex(0); return; }
        if (input === 'w') { setFilterLevel('warn'); setSelectedIndex(0); return; }
        if (input === 'e') { setFilterLevel('error'); setSelectedIndex(0); return; }
        if (input === 'a') { setFilterLevel('all'); setSelectedIndex(0); return; }
    });

    const levelColors: Record<LogLevel, string> = {
        debug: theme.textMuted,
        info: theme.primary,
        warn: theme.warning,
        error: theme.error,
        success: theme.success,
    };

    return (
        <Box flexDirection="column" width={width} height={height}>
            <Box paddingX={1} justifyContent="space-between">
                <Text>
                    {styles.accent('Logs')} <Text color={themeColor(theme, theme.textMuted)}>({filtered.length}/{logs.length})</Text>
                </Text>
                <Text color={themeColor(theme, theme.textMuted)}>
                    Filter: {filterLevel === 'all' ? styles.primary('[A]ll') : '[A]ll'}{' '}
                    {filterLevel === 'debug' ? styles.primary('[D]ebug') : '[D]ebug'}{' '}
                    {filterLevel === 'info' ? styles.primary('[I]nfo') : '[I]nfo'}{' '}
                    {filterLevel === 'warn' ? styles.primary('[W]arn') : '[W]arn'}{' '}
                    {filterLevel === 'error' ? styles.primary('[E]rror') : '[E]rror'}
                </Text>
            </Box>
            <Box flexDirection="column" paddingX={1}>
                {visible.map((entry, i) => {
                    const absIdx = scrollOffset + i;
                    const isSel = absIdx === selectedIndex;
                    const timeStr = entry.timestamp.toLocaleTimeString();
                    const levelIcon = LEVEL_ICONS[entry.level];
                    const color = levelColors[entry.level];
                    const msg = entry.message.length > width - 30
                        ? entry.message.slice(0, width - 33) + '...'
                        : entry.message;
                    return (
                        <Box key={entry.id}>
                            <Text>
                                {isSel ? styles.accent('▸ ') : '  '}
                                <Text color={themeColor(theme, theme.textMuted)}>{timeStr}</Text>
                                {' '}
                                <Text color={themeColor(theme, color)}>{levelIcon}</Text>
                                {' '}
                                {entry.source ? <Text color={themeColor(theme, theme.textMuted)}>[{entry.source}] </Text> : null}
                                <Text color={themeColor(theme, isSel ? theme.textEmphasized : theme.text)}>{msg}</Text>
                            </Text>
                        </Box>
                    );
                })}
            </Box>
            {showDetails && selected && (
                <Box flexDirection="column" paddingX={1} marginTop={1} borderStyle="single" borderColor={themeColor(theme, theme.borderFocused)}>
                    <Text color={themeColor(theme, theme.textEmphasized)} bold>Details</Text>
                    <Text color={themeColor(theme, theme.textMuted)}>Time: {selected.timestamp.toISOString()}</Text>
                    <Text color={themeColor(theme, theme.textMuted)}>Level: <Text color={themeColor(theme, levelColors[selected.level])}>{selected.level}</Text></Text>
                    {selected.source && <Text color={themeColor(theme, theme.textMuted)}>Source: {selected.source}</Text>}
                    <Text color={themeColor(theme, theme.text)} wrap="wrap">{selected.message}</Text>
                    {selected.attributes && Object.keys(selected.attributes).length > 0 && (
                        <Box flexDirection="column" marginTop={1}>
                            <Text color={themeColor(theme, theme.textMuted)}>Attributes:</Text>
                            {Object.entries(selected.attributes).map(([k, v]) => (
                                <Text key={k} color={themeColor(theme, theme.textMuted)}>  {k}: {JSON.stringify(v)}</Text>
                            ))}
                        </Box>
                    )}
                </Box>
            )}
            <Box paddingX={1} marginTop={1}>
                <Text color={themeColor(theme, theme.textMuted)}>↑↓ select  Enter details  d/i/w/e/a filter  Esc close</Text>
            </Box>
        </Box>
    );
}
