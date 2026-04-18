// ============================================================
// File Operation Toolset
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolApprovalRequest, ToolContext } from './tool.js';
import { createFileDiffPreview, truncatePreview } from './diff.js';
import { isSandboxAccessError, resolvePathWithinProject } from './sandbox.js';

/** High-risk path identification. Used to escalate risk and warnings during write_file approval. */
function getWritePathRisk(filePath: string): 'high' | 'medium' {
    const normalized = path.normalize(filePath);
    const segments = normalized.split(path.sep);
    const basename = path.basename(normalized).toLowerCase();

    // Hidden directories/files (e.g., .git, .env, .env.local)
    if (segments.some((s) => s.startsWith('.'))) {
        return 'high';
    }
    if (basename.startsWith('.env') || basename === '.npmrc' || basename === '.dockerignore' || basename === '.gitignore') {
        return 'high';
    }

    // shell / scripts
    const ext = path.extname(normalized).toLowerCase();
    if (['.sh', '.bash', '.ps1'].includes(ext)) {
        return 'high';
    }

    // CI / common config paths
    if (segments.includes('.github') || segments.includes('.gitlab') || basename === '.gitlab-ci.yml') {
        return 'high';
    }
    if (['.yml', '.yaml'].includes(ext) && (basename.includes('ci') || basename.includes('config') || basename.includes('workflow'))) {
        return 'high';
    }

    return 'medium';
}

// ---- ReadFileTool ----

export class ReadFileTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'read_file',
        description: 'Read the content of a specified file. Can read all or part of a text file.',
        parameters: [
            { name: 'path', type: 'string', description: 'File path (relative to project root or absolute path)', required: true },
            { name: 'startLine', type: 'number', description: 'Start line number (optional, 1-based)', required: false },
            { name: 'endLine', type: 'number', description: 'End line number (optional)', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        let filePath: string;
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            filePath = resolvePathWithinProject(args['path'] as string, context);
            if (!fs.existsSync(filePath)) {
                return { toolCallId, success: false, output: '', error: `File does not exist: ${filePath}` };
            }

            let content = fs.readFileSync(filePath, 'utf-8');
            const startLine = args['startLine'] as number | undefined;
            const endLine = args['endLine'] as number | undefined;

            if (startLine !== undefined || endLine !== undefined) {
                const lines = content.split('\n');
                const start = (startLine ?? 1) - 1;
                const end = endLine ?? lines.length;
                content = lines.slice(start, end).join('\n');
            }

            return { toolCallId, success: true, output: content };
        } catch (err) {
            if (isSandboxAccessError(err)) {
                throw err;
            }
            return { toolCallId, success: false, output: '', error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` };
        }
    }
}

// ---- WriteFileTool ----

export class WriteFileTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'write_file',
        description: 'Write content to a specified file. Creates the file if it doesn\'t exist, and automatically creates parent directories if needed.',
        parameters: [
            { name: 'path', type: 'string', description: 'File path', required: true },
            { name: 'content', type: 'string', description: 'The content to write to the file', required: true },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>, context: ToolContext): ToolApprovalRequest {
        const inputPath = args['path'] as string;
        const nextContent = args['content'] as string;
        const filePath = resolvePathWithinProject(inputPath, context);
        const isNewFile = !fs.existsSync(filePath);

        const risk = getWritePathRisk(filePath);
        if (isNewFile) {
            return {
                toolCallId: '',
                toolName: 'write_file',
                summary: `Create new file ${filePath}`,
                reason: risk === 'high' ? 'This path is high-risk (e.g., hidden directory/environment/CI/script). Creation needs confirmation.' : 'This operation creates a new file; content must be confirmed before execution.',
                preview: createFileDiffPreview(filePath, '', nextContent),
                risk,
            };
        }

        const currentContent = fs.readFileSync(filePath, 'utf-8');
        return {
            toolCallId: '',
            toolName: 'write_file',
            summary: `Overwrite file ${filePath}`,
            reason: risk === 'high' ? 'This path is high-risk (e.g., hidden directory/environment/CI/script). Overwriting needs confirmation.' : 'This operation modifies an existing file; diff must be confirmed before execution.',
            preview: createFileDiffPreview(filePath, currentContent, nextContent),
            risk,
        };
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        let filePath: string;
        const content = args['content'] as string;

        try {
            filePath = resolvePathWithinProject(args['path'] as string, context);
            const dir = path.dirname(filePath);
            const existedBefore = fs.existsSync(filePath);
            const rollbackPoint = context.rollbackStore?.createPoint({
                sessionId: context.sessionId,
                projectRoot: context.projectRoot,
                toolName: 'write_file',
                filePaths: [filePath],
            });

            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, content, 'utf-8');

            const outputLines = [`File written successfully: ${filePath}`];
            if (rollbackPoint) {
                outputLines.push(`Rollback point: ${rollbackPoint.id}`);
            }

            return {
                toolCallId,
                success: true,
                output: outputLines.join('\n'),
                metadata: {
                    path: filePath,
                    changeType: 'write',
                    bytes: Buffer.byteLength(content, 'utf-8'),
                    existedBefore,
                    timestamp: new Date().toISOString(),
                    ...(rollbackPoint ? { rollbackPointId: rollbackPoint.id } : {}),
                },
            };
        } catch (err) {
            if (isSandboxAccessError(err)) {
                throw err;
            }
            return { toolCallId, success: false, output: '', error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}` };
        }
    }
}

// ---- PreviewDiffTool ----

export class PreviewDiffTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'preview_diff',
        description: 'Preview the unified diff after writing to a file, without actually modifying the file.',
        parameters: [
            { name: 'path', type: 'string', description: 'Target file path', required: true },
            { name: 'content', type: 'string', description: 'The new content expected to be written', required: true },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            const filePath = resolvePathWithinProject(args['path'] as string, context);
            const nextContent = args['content'] as string;
            const currentContent = fs.existsSync(filePath)
                ? fs.readFileSync(filePath, 'utf-8')
                : '';

            return {
                toolCallId,
                success: true,
                output: createFileDiffPreview(filePath, currentContent, nextContent),
                metadata: {
                    path: filePath,
                },
            };
        } catch (err) {
            if (isSandboxAccessError(err)) {
                throw err;
            }
            return {
                toolCallId,
                success: false,
                output: '',
                error: `Failed to preview diff: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

// ---- SearchCodeTool ----

export class SearchCodeTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'search_code',
        description: 'Search for code in the project. Supports regular expressions and glob file matching.',
        parameters: [
            { name: 'pattern', type: 'string', description: 'Search pattern (string or regular expression)', required: true },
            { name: 'path', type: 'string', description: 'Search path (defaults to current project directory)', required: false },
            { name: 'include', type: 'string', description: 'File matching glob (e.g., "*.ts")', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const pattern = args['pattern'] as string;
        const searchPath = (args['path'] as string) ?? '.';
        const include = args['include'] as string | undefined;
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            const resolvedSearchPath = resolvePathWithinProject(searchPath, context);
            const rgArgs = [
                '--line-number',
                '--no-heading',
                '--color',
                'never',
                '--max-count',
                '50',
            ];

            if (include) {
                rgArgs.push('--glob', include);
            }
            rgArgs.push(pattern, resolvedSearchPath);

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
                    error: `Search failed: ${result.error.message}`,
                };
            }

            if (result.status === 1) {
                return { toolCallId, success: true, output: 'No matching results found' };
            }

            if (result.status !== 0) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Search failed: ${result.stderr || `rg exit code ${result.status}`}`,
                };
            }

            return { toolCallId, success: true, output: truncatePreview(result.stdout || 'No matching results found') };
        } catch (err) {
            if (isSandboxAccessError(err)) {
                throw err;
            }
            return { toolCallId, success: false, output: '', error: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    }
}
