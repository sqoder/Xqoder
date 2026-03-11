import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolContext } from './tool.js';
import { truncatePreview } from './diff.js';
import { resolvePathWithinProject } from './sandbox.js';

const MAX_DISCOVERY_ITEMS = 200;

export class ListFilesTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'list_files',
        description: '以树状结构列出目录中的文件和子目录。',
        parameters: [
            { name: 'path', type: 'string', description: '目录路径，默认当前目录', required: false },
            { name: 'maxDepth', type: 'number', description: '最大递归深度，默认 3', required: false },
            { name: 'includeHidden', type: 'boolean', description: '是否包含隐藏文件', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            const rootPath = resolvePathWithinProject((args['path'] as string) ?? '.', context);
            const maxDepth = Math.max(0, Math.min(8, Number(args['maxDepth'] ?? 3)));
            const includeHidden = Boolean(args['includeHidden']);
            const lines: string[] = [];

            walkDirectory(rootPath, rootPath, 0, maxDepth, includeHidden, lines);

            return {
                toolCallId,
                success: true,
                output: lines.length > 0 ? lines.slice(0, MAX_DISCOVERY_ITEMS).join('\n') : '(empty)',
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `列出文件失败: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

export class GlobFilesTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'glob_files',
        description: '使用 glob 模式查找文件路径，例如 src/**/*.ts。',
        parameters: [
            { name: 'pattern', type: 'string', description: 'glob 模式，例如 "src/**/*.ts"', required: true },
            { name: 'path', type: 'string', description: '搜索根目录，默认当前项目目录', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            const pattern = args['pattern'] as string;
            const searchRoot = resolvePathWithinProject((args['path'] as string) ?? '.', context);
            const relativeRoot = path.relative(context.projectRoot, searchRoot);
            const result = spawnSync('rg', [
                '--files',
                '--color',
                'never',
                '-g',
                pattern,
            ], {
                cwd: searchRoot,
                encoding: 'utf-8',
                timeout: 10000,
            });

            if (result.error) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `glob 搜索失败: ${result.error.message}`,
                };
            }

            if (result.status === 1) {
                return {
                    toolCallId,
                    success: true,
                    output: '未找到匹配文件',
                };
            }

            if (result.status !== 0) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `glob 搜索失败: ${result.stderr || `rg 退出码 ${result.status}`}`,
                };
            }

            return {
                toolCallId,
                success: true,
                output: truncatePreview(formatGlobOutput(result.stdout || '', relativeRoot)),
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `glob 搜索失败: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

export class GrepContentTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'grep_content',
        description: '在文件内容中搜索匹配项，可配合 include glob 过滤文件类型。',
        parameters: [
            { name: 'pattern', type: 'string', description: '搜索模式', required: true },
            { name: 'path', type: 'string', description: '搜索路径，默认当前项目目录', required: false },
            { name: 'include', type: 'string', description: '文件匹配 glob，例如 "*.tsx"', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            const pattern = args['pattern'] as string;
            const searchRoot = resolvePathWithinProject((args['path'] as string) ?? '.', context);
            const include = args['include'] as string | undefined;
            const rgArgs = [
                '--line-number',
                '--no-heading',
                '--color',
                'never',
                '--max-count',
                '100',
            ];

            if (include) {
                rgArgs.push('--glob', include);
            }

            rgArgs.push(pattern, searchRoot);

            const result = spawnSync('rg', rgArgs, {
                cwd: context.projectRoot,
                encoding: 'utf-8',
                timeout: 10000,
            });

            if (result.error) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `grep 搜索失败: ${result.error.message}`,
                };
            }

            if (result.status === 1) {
                return {
                    toolCallId,
                    success: true,
                    output: '未找到匹配结果',
                };
            }

            if (result.status !== 0) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `grep 搜索失败: ${result.stderr || `rg 退出码 ${result.status}`}`,
                };
            }

            return {
                toolCallId,
                success: true,
                output: truncatePreview(result.stdout || '未找到匹配结果'),
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `grep 搜索失败: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

function walkDirectory(
    rootPath: string,
    currentPath: string,
    depth: number,
    maxDepth: number,
    includeHidden: boolean,
    lines: string[],
): void {
    if (depth > maxDepth || lines.length >= MAX_DISCOVERY_ITEMS) {
        return;
    }

    const entries = fs.readdirSync(currentPath, { withFileTypes: true })
        .filter((entry) => includeHidden || !entry.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        if (lines.length >= MAX_DISCOVERY_ITEMS) {
            return;
        }

        const absolutePath = path.join(currentPath, entry.name);
        const relativePath = path.relative(rootPath, absolutePath) || entry.name;
        const prefix = `${'  '.repeat(depth)}- `;

        lines.push(`${prefix}${relativePath}${entry.isDirectory() ? '/' : ''}`);

        if (entry.isDirectory()) {
            walkDirectory(rootPath, absolutePath, depth + 1, maxDepth, includeHidden, lines);
        }
    }
}

function formatGlobOutput(stdout: string, relativeRoot: string): string {
    const trimmed = stdout.trim();
    if (!trimmed) {
        return '未找到匹配文件';
    }

    const normalizedRoot = relativeRoot && relativeRoot !== '.'
        ? relativeRoot.replace(/\\/g, '/')
        : '';

    return trimmed
        .split('\n')
        .filter(Boolean)
        .map((entry) => {
            const normalizedEntry = entry.replace(/\\/g, '/');
            return normalizedRoot ? `${normalizedRoot}/${normalizedEntry}` : normalizedEntry;
        })
        .join('\n');
}
