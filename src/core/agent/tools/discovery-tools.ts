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
        description: 'Lists files and subdirectories in a directory as a tree structure.',
        parameters: [
            { name: 'path', type: 'string', description: 'Directory path (defaults to current directory)', required: false },
            { name: 'maxDepth', type: 'number', description: 'Maximum recursion depth (defaults to 3)', required: false },
            { name: 'includeHidden', type: 'boolean', description: 'Whether to include hidden files', required: false },
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
                error: `Failed to list files: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

export class GlobFilesTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'glob_files',
        description: 'Find file paths using glob patterns, for example src/**/*.ts.',
        parameters: [
            { name: 'pattern', type: 'string', description: 'Glob pattern, e.g., "src/**/*.ts"', required: true },
            { name: 'path', type: 'string', description: 'Search root directory (defaults to current project directory)', required: false },
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
                    error: `Glob search failed: ${result.error.message}`,
                };
            }

            if (result.status === 1) {
                return {
                    toolCallId,
                    success: true,
                    output: 'No matching files found',
                };
            }

            if (result.status !== 0) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Glob search failed: ${result.stderr || `rg exit code ${result.status}`}`,
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
                error: `Glob search failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

export class GrepContentTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'grep_content',
        description: 'Search for matches within file content, optionally filtering file types with an include glob.',
        parameters: [
            { name: 'pattern', type: 'string', description: 'Search pattern', required: true },
            { name: 'path', type: 'string', description: 'Search path (defaults to current project directory)', required: false },
            { name: 'include', type: 'string', description: 'File match glob, e.g., "*.tsx"', required: false },
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
                    error: `Grep search failed: ${result.error.message}`,
                };
            }

            if (result.status === 1) {
                return {
                    toolCallId,
                    success: true,
                    output: 'No matching results found',
                };
            }

            if (result.status !== 0) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Grep search failed: ${result.stderr || `rg exit code ${result.status}`}`,
                };
            }

            return {
                toolCallId,
                success: true,
                output: truncatePreview(result.stdout || 'No matching results found'),
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `Grep search failed: ${err instanceof Error ? err.message : String(err)}`,
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
        return 'No matching files found';
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
