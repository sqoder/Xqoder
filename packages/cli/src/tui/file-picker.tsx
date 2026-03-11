// ============================================================
// 文件选择器组件 — 参考 OpenCode 的文件浏览器
// ============================================================

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { getTheme, createThemedStyles } from './theme.js';

/** 文件条目 */
interface FileEntry {
    name: string;
    fullPath: string;
    isDirectory: boolean;
    size?: number;
}

/** 文件选择器属性 */
interface FilePickerProps {
    cwd: string;
    width: number;
    height: number;
    onSelect: (filePath: string) => void;
    onCancel: () => void;
    extensions?: string[]; // 过滤扩展名
}

/**
 * FilePicker
 * 文件浏览和选择器组件
 */
export function FilePicker({
    cwd,
    width,
    height,
    onSelect,
    onCancel,
    extensions,
}: FilePickerProps): React.JSX.Element {
    const theme = getTheme();
    const styles = createThemedStyles(theme);
    const [currentDir, setCurrentDir] = useState(cwd);
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [filter, setFilter] = useState('');

    // 读取目录内容
    useEffect(() => {
        try {
            const items = fs.readdirSync(currentDir, { withFileTypes: true });
            const fileEntries: FileEntry[] = items
                .filter(item => {
                    // 过滤隐藏文件
                    if (item.name.startsWith('.')) return false;
                    // 过滤 node_modules
                    if (item.name === 'node_modules') return false;
                    if (item.name === 'dist') return false;
                    // 如果是文件，检查扩展名
                    if (!item.isDirectory() && extensions?.length) {
                        const ext = path.extname(item.name).slice(1);
                        return extensions.includes(ext);
                    }
                    return true;
                })
                .map(item => ({
                    name: item.name,
                    fullPath: path.join(currentDir, item.name),
                    isDirectory: item.isDirectory(),
                    size: item.isDirectory() ? undefined : (() => {
                        try {
                            return fs.statSync(path.join(currentDir, item.name)).size;
                        } catch {
                            return undefined;
                        }
                    })(),
                }))
                .sort((a, b) => {
                    // 目录优先
                    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });

            setEntries(fileEntries);
            setSelectedIndex(0);
        } catch {
            setEntries([]);
        }
    }, [currentDir]);

    // 过滤后的条目
    const filtered = filter
        ? entries.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()))
        : entries;

    useInput((input, key) => {
        if (key.escape) {
            onCancel();
            return;
        }

        if (key.upArrow) {
            setSelectedIndex(Math.max(0, selectedIndex - 1));
        } else if (key.downArrow) {
            setSelectedIndex(Math.min(filtered.length - 1, selectedIndex + 1));
        } else if (key.return && filtered[selectedIndex]) {
            const entry = filtered[selectedIndex];
            if (entry.isDirectory) {
                setCurrentDir(entry.fullPath);
            } else {
                onSelect(entry.fullPath);
            }
        } else if (key.backspace || key.delete) {
            if (filter.length > 0) {
                setFilter(filter.slice(0, -1));
            } else {
                // 返回上级目录
                const parent = path.dirname(currentDir);
                if (parent !== currentDir) {
                    setCurrentDir(parent);
                }
            }
        } else if (input && !key.ctrl && !key.meta) {
            setFilter(filter + input);
        }
    });

    const visibleHeight = height - 4; // 标题 + 路径 + 过滤 + 底部
    const scrollOffset = Math.max(0, selectedIndex - visibleHeight + 1);
    const visibleEntries = filtered.slice(scrollOffset, scrollOffset + visibleHeight);

    return (
        <Box
            flexDirection="column"
            width={width}
            height={height}
            borderStyle="round"
            borderColor={theme.primary}
            paddingX={1}
        >
            {/* 标题 */}
            <Box>
                <Text bold color={theme.primary}>
                    📁 File Picker
                </Text>
            </Box>

            {/* 当前路径 */}
            <Box>
                <Text color={theme.textMuted}>
                    {truncatePath(currentDir, width - 4)}
                </Text>
            </Box>

            {/* 过滤器 */}
            {filter && (
                <Box>
                    <Text color={theme.accent}>
                        🔍 {filter}
                    </Text>
                </Box>
            )}

            {/* 文件列表 */}
            <Box flexDirection="column" overflow="hidden">
                {visibleEntries.map((entry, viewIdx) => {
                    const actualIdx = scrollOffset + viewIdx;
                    const isSelected = actualIdx === selectedIndex;
                    const icon = entry.isDirectory ? '📂' : getFileIcon(entry.name);
                    const sizeStr = entry.size !== undefined
                        ? formatSize(entry.size)
                        : '';

                    return (
                        <Box key={entry.fullPath}>
                            <Text>
                                {isSelected ? styles.accent('▸ ') : '  '}
                                {icon} {' '}
                                {entry.isDirectory
                                    ? styles.emphasized(entry.name + '/')
                                    : isSelected
                                        ? styles.text(entry.name)
                                        : styles.muted(entry.name)}
                                {sizeStr && ` ${styles.muted(sizeStr)}`}
                            </Text>
                        </Box>
                    );
                })}
            </Box>

            {/* 底部信息 */}
            <Box>
                <Text color={theme.textMuted}>
                    {filtered.length} items · ↑↓ Navigate · Enter Select · Esc Cancel
                </Text>
            </Box>
        </Box>
    );
}

/** 缩短路径 */
function truncatePath(p: string, maxLen: number): string {
    if (p.length <= maxLen) return p;
    const parts = p.split(path.sep);
    let result = parts[parts.length - 1];
    for (let i = parts.length - 2; i >= 0; i--) {
        const next = parts[i] + path.sep + result;
        if (next.length > maxLen - 3) {
            return '...' + path.sep + result;
        }
        result = next;
    }
    return result;
}

/** 文件图标 */
function getFileIcon(name: string): string {
    const ext = path.extname(name).toLowerCase();
    const icons: Record<string, string> = {
        '.ts': '🟦', '.tsx': '🟦', '.js': '🟨', '.jsx': '🟨',
        '.py': '🐍', '.go': '🔵', '.rs': '🦀', '.rb': '💎',
        '.json': '📋', '.yaml': '📋', '.yml': '📋', '.toml': '📋',
        '.md': '📝', '.txt': '📄', '.html': '🌐', '.css': '🎨',
        '.svg': '🖼️', '.png': '🖼️', '.jpg': '🖼️',
        '.sh': '⚙️', '.bash': '⚙️', '.zsh': '⚙️',
    };
    return icons[ext] ?? '📄';
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}
