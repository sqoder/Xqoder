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
        description: 'Apply a unified diff patch to modify project files. Suitable for making precise changes to existing files.',
        parameters: [
            { name: 'patch', type: 'string', description: 'Unified diff patch content', required: true },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>, context: ToolContext): ToolApprovalRequest {
        const patch = args['patch'] as string;
        const filePaths = resolvePatchFilePaths(patch, context);

        return {
            toolCallId: '',
            toolName: 'apply_patch',
            summary: `Apply patch to ${filePaths.length} files`,
            reason: 'This operation modifies files based on a diff; the patch content must be confirmed before execution.',
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

            const outputLines = [`Patch applied, affected files: ${filePaths.join(', ')}`];
            if (rollbackPoint) {
                outputLines.push(`Rollback point: ${rollbackPoint.id}`);
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
                error: `Failed to apply patch: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

export class RestoreRollbackPointTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'restore_rollback_point',
        description: 'Restores previous file states based on a rollback point ID.',
        parameters: [
            { name: 'rollbackPointId', type: 'string', description: 'Rollback point ID', required: true },
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
            summary: `Restore rollback point ${rollbackPointId}`,
            reason: 'This operation restores files to a historical snapshot.',
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
                error: 'Rollback store is not enabled in the current environment',
            };
        }

        try {
            const point = context.rollbackStore.restorePoint(rollbackPointId);
            return {
                toolCallId,
                success: true,
                output: `Restored rollback point ${point.id}, files: ${point.filePaths.join(', ')}`,
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
                error: `Failed to restore rollback point: ${err instanceof Error ? err.message : String(err)}`,
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
        throw new Error('No target files resolved from patch');
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
                error: check.stderr || check.stdout || 'git apply --check failed',
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
                error: apply.stderr || 'git apply failed',
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
