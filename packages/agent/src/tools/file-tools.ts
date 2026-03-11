// ============================================================
// 文件操作工具集
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolApprovalRequest, ToolContext } from './tool.js';
import { createFileDiffPreview, truncatePreview } from './diff.js';
import { isSandboxAccessError, resolvePathWithinProject } from './sandbox.js';

/** Day 8：高风险路径识别。用于 write_file 审批时提升 risk 与提示。 */
function getWritePathRisk(filePath: string): 'high' | 'medium' {
    const normalized = path.normalize(filePath);
    const segments = normalized.split(path.sep);
    const basename = path.basename(normalized).toLowerCase();

    // 隐藏目录/文件（如 .git、.env、.env.local）
    if (segments.some((s) => s.startsWith('.'))) {
        return 'high';
    }
    if (basename.startsWith('.env') || basename === '.npmrc' || basename === '.dockerignore' || basename === '.gitignore') {
        return 'high';
    }

    // shell / 脚本
    const ext = path.extname(normalized).toLowerCase();
    if (['.sh', '.bash', '.ps1'].includes(ext)) {
        return 'high';
    }

    // CI / config 常见路径
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
        description: '读取指定文件的内容。可以读取文本文件的全部或部分内容。',
        parameters: [
            { name: 'path', type: 'string', description: '文件路径（相对于项目根目录或绝对路径）', required: true },
            { name: 'startLine', type: 'number', description: '起始行号（可选，从1开始）', required: false },
            { name: 'endLine', type: 'number', description: '结束行号（可选）', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        let filePath: string;
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            filePath = resolvePathWithinProject(args['path'] as string, context);
            if (!fs.existsSync(filePath)) {
                return { toolCallId, success: false, output: '', error: `文件不存在: ${filePath}` };
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
            return { toolCallId, success: false, output: '', error: `读取文件失败: ${err instanceof Error ? err.message : String(err)}` };
        }
    }
}

// ---- WriteFileTool ----

export class WriteFileTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'write_file',
        description: '写入内容到指定文件。如果文件不存在则创建，如果目录不存在则自动创建。',
        parameters: [
            { name: 'path', type: 'string', description: '文件路径', required: true },
            { name: 'content', type: 'string', description: '要写入的文件内容', required: true },
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
                summary: `新建文件 ${filePath}`,
                reason: risk === 'high' ? '该路径属于高风险（如隐藏目录/环境/CI/脚本），创建新文件需确认。' : '该操作会创建新文件，执行前需要确认内容。',
                preview: createFileDiffPreview(filePath, '', nextContent),
                risk,
            };
        }

        const currentContent = fs.readFileSync(filePath, 'utf-8');
        return {
            toolCallId: '',
            toolName: 'write_file',
            summary: `覆盖文件 ${filePath}`,
            reason: risk === 'high' ? '该路径属于高风险（如隐藏目录/环境/CI/脚本），覆盖需确认。' : '该操作会修改已有文件，执行前需要确认 diff。',
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

            const outputLines = [`文件已写入: ${filePath}`];
            if (rollbackPoint) {
                outputLines.push(`回滚点: ${rollbackPoint.id}`);
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
            return { toolCallId, success: false, output: '', error: `写入文件失败: ${err instanceof Error ? err.message : String(err)}` };
        }
    }
}

// ---- PreviewDiffTool ----

export class PreviewDiffTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'preview_diff',
        description: '预览文件写入后的 unified diff，不会真正修改文件。',
        parameters: [
            { name: 'path', type: 'string', description: '目标文件路径', required: true },
            { name: 'content', type: 'string', description: '预期写入的新内容', required: true },
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
                error: `预览 diff 失败: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

// ---- SearchCodeTool ----

export class SearchCodeTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'search_code',
        description: '在项目中搜索代码。支持正则表达式和 glob 文件匹配。',
        parameters: [
            { name: 'pattern', type: 'string', description: '搜索模式（字符串或正则表达式）', required: true },
            { name: 'path', type: 'string', description: '搜索路径（默认当前项目目录）', required: false },
            { name: 'include', type: 'string', description: '文件匹配 glob（如 "*.ts"）', required: false },
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
                    error: `搜索失败: ${result.error.message}`,
                };
            }

            if (result.status === 1) {
                return { toolCallId, success: true, output: '未找到匹配结果' };
            }

            if (result.status !== 0) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `搜索失败: ${result.stderr || `rg 退出码 ${result.status}`}`,
                };
            }

            return { toolCallId, success: true, output: truncatePreview(result.stdout || '未找到匹配结果') };
        } catch (err) {
            if (isSandboxAccessError(err)) {
                throw err;
            }
            return { toolCallId, success: false, output: '', error: `搜索失败: ${err instanceof Error ? err.message : String(err)}` };
        }
    }
}
