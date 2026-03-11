import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolApprovalRequest, ToolContext } from './tool.js';
import { truncatePreview } from './diff.js';
import { resolvePathWithinProject } from './sandbox.js';

export class ApplyPatchTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'apply_patch',
        description: '应用 unified diff patch 来修改项目文件。适合对已有文件做精确修改。',
        parameters: [
            { name: 'patch', type: 'string', description: 'unified diff patch 内容', required: true },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>, context: ToolContext): ToolApprovalRequest {
        const patch = args['patch'] as string;
        const filePaths = resolvePatchFilePaths(patch, context);

        return {
            toolCallId: '',
            toolName: 'apply_patch',
            summary: `应用 patch 到 ${filePaths.length} 个文件`,
            reason: '该操作会按 diff 修改文件，执行前需要确认补丁内容。',
            preview: truncatePreview(patch),
            risk: 'high',
        };
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const patch = args['patch'] as string;

        try {
            const filePaths = resolvePatchFilePaths(patch, context);
            const rollbackPoint = context.rollbackStore?.createPoint({
                sessionId: context.sessionId,
                projectRoot: context.projectRoot,
                toolName: 'apply_patch',
                filePaths,
            });
            const result = applyPatchInProject(patch, context.projectRoot);

            if (!result.success) {
                return {
                    toolCallId,
                    success: false,
                    output: result.output,
                    error: result.error,
                    metadata: {
                        filePaths,
                        changeType: 'patch',
                        ...(rollbackPoint ? { rollbackPointId: rollbackPoint.id } : {}),
                    },
                };
            }

            const outputLines = [`补丁已应用，影响文件: ${filePaths.join(', ')}`];
            if (rollbackPoint) {
                outputLines.push(`回滚点: ${rollbackPoint.id}`);
            }

            return {
                toolCallId,
                success: true,
                output: outputLines.join('\n'),
                metadata: {
                    filePaths,
                    changeType: 'patch',
                    ...(rollbackPoint ? { rollbackPointId: rollbackPoint.id } : {}),
                },
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `应用补丁失败: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

export class RestoreRollbackPointTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'restore_rollback_point',
        description: '根据 rollback point ID 恢复之前的文件状态。',
        parameters: [
            { name: 'rollbackPointId', type: 'string', description: '回滚点 ID', required: true },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>, context: ToolContext): ToolApprovalRequest | undefined {
        const rollbackPointId = args['rollbackPointId'] as string;
        const point = context.rollbackStore?.getPoint(rollbackPointId);
        if (!point) {
            return undefined;
        }

        return {
            toolCallId: '',
            toolName: 'restore_rollback_point',
            summary: `恢复回滚点 ${rollbackPointId}`,
            reason: '该操作会把文件恢复到历史快照。',
            preview: point.filePaths.join('\n'),
            risk: 'high',
        };
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const rollbackPointId = args['rollbackPointId'] as string;

        if (!context.rollbackStore) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: '当前环境未启用 rollback store',
            };
        }

        try {
            const point = context.rollbackStore.restorePoint(rollbackPointId);
            return {
                toolCallId,
                success: true,
                output: `已恢复回滚点 ${point.id}，文件: ${point.filePaths.join(', ')}`,
                metadata: {
                    rollbackPointId: point.id,
                    filePaths: point.filePaths,
                    changeType: 'restore',
                },
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `恢复回滚点失败: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

function resolvePatchFilePaths(patch: string, context: ToolContext): string[] {
    const filePaths = new Set<string>();
    const lines = patch.split('\n');

    for (const line of lines) {
        if (line.startsWith('+++ ') || line.startsWith('--- ')) {
            const rawPath = line.slice(4).trim();
            if (rawPath === '/dev/null') {
                continue;
            }

            filePaths.add(resolvePathWithinProject(stripPatchPrefix(rawPath), context));
            continue;
        }

        if (line.startsWith('diff --git ')) {
            const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
            const candidate = match?.[2] ?? match?.[1];
            if (candidate) {
                filePaths.add(resolvePathWithinProject(candidate, context));
            }
        }
    }

    if (filePaths.size === 0) {
        throw new Error('patch 中未解析出任何目标文件');
    }

    return Array.from(filePaths);
}

function stripPatchPrefix(value: string): string {
    if (value.startsWith('a/') || value.startsWith('b/')) {
        return value.slice(2);
    }

    return value;
}

function applyPatchInProject(
    patch: string,
    projectRoot: string,
): {
    success: boolean;
    output: string;
    error?: string;
} {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-patch-'));
    const patchFile = path.join(tempDir, 'change.patch');

    try {
        fs.writeFileSync(patchFile, patch, 'utf-8');

        const check = spawnSync('git', [
            'apply',
            '--check',
            '--whitespace=nowarn',
            patchFile,
        ], {
            cwd: projectRoot,
            encoding: 'utf-8',
        });

        if (check.status !== 0) {
            return {
                success: false,
                output: '',
                error: check.stderr || check.stdout || 'git apply --check 失败',
            };
        }

        const apply = spawnSync('git', [
            'apply',
            '--whitespace=nowarn',
            patchFile,
        ], {
            cwd: projectRoot,
            encoding: 'utf-8',
        });

        if (apply.status !== 0) {
            return {
                success: false,
                output: apply.stdout || '',
                error: apply.stderr || 'git apply 失败',
            };
        }

        return {
            success: true,
            output: apply.stdout || 'patch applied',
        };
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
