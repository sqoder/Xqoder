// ============================================================
// 命令执行工具
// ============================================================

import { spawn } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolApprovalRequest, ToolContext } from './tool.js';
import { isSandboxAccessError, resolveWorkingDirectory, validateCommandSafety } from './sandbox.js';

/**
 * RunCommandTool
 * 在终端中执行命令并返回输出
 */
export class RunCommandTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'run_command',
        description: '在终端中执行 shell 命令。可以用来安装依赖、运行脚本、执行构建等任务。',
        parameters: [
            { name: 'command', type: 'string', description: '要执行的 shell 命令', required: true },
            { name: 'cwd', type: 'string', description: '工作目录（可选，默认使用项目根目录）', required: false },
            { name: 'timeout', type: 'number', description: '超时时间（毫秒，默认 30000）', required: false },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>): ToolApprovalRequest {
        const command = args['command'] as string;

        return {
            toolCallId: '',
            toolName: 'run_command',
            summary: `执行命令: ${command}`,
            reason: 'shell 命令会直接影响项目环境或文件系统。',
            preview: command,
            risk: 'high',
        };
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const command = args['command'] as string;
        const timeout = (args['timeout'] as number) ?? 30000;
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const startedAt = new Date();
        let cwd: string;

        return new Promise<ToolResult>((resolve, reject) => {
            const safetyError = validateCommandSafety(command);
            if (safetyError) {
                resolve({
                    toolCallId,
                    success: false,
                    output: '',
                    error: safetyError,
                    metadata: createCommandMetadata(command, context.cwd, timeout, startedAt, new Date()),
                });
                return;
            }

            try {
                cwd = resolveWorkingDirectory(args['cwd'] as string | undefined, context);
            } catch (err) {
                if (isSandboxAccessError(err)) {
                    reject(err);
                    return;
                }
                resolve({
                    toolCallId,
                    success: false,
                    output: '',
                    error: err instanceof Error ? err.message : String(err),
                    metadata: createCommandMetadata(command, context.cwd, timeout, startedAt, new Date()),
                });
                return;
            }

            let stdout = '';
            let stderr = '';
            let killed = false;

            const shellPath = context.shell?.path ?? process.env.SHELL ?? '/bin/sh';
            const shellArgs = context.shell?.args ?? ['-c'];

            const child = spawn(shellPath, [...shellArgs, command], {
                cwd,
                env: { ...process.env, ...context.env },
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            // 超时处理
            const timer = setTimeout(() => {
                killed = true;
                child.kill('SIGTERM');
            }, timeout);

            child.stdout?.on('data', (data: Buffer) => {
                const chunk = data.toString();
                stdout += chunk;
                context.onToolStream?.({
                    chunk,
                    stream: 'stdout',
                });
                // 限制输出大小
                if (stdout.length > 50000) {
                    stdout = stdout.slice(-50000);
                }
            });

            child.stderr?.on('data', (data: Buffer) => {
                const chunk = data.toString();
                stderr += chunk;
                context.onToolStream?.({
                    chunk,
                    stream: 'stderr',
                });
                if (stderr.length > 20000) {
                    stderr = stderr.slice(-20000);
                }
            });

            child.on('close', (code) => {
                clearTimeout(timer);

                if (killed) {
                    resolve({
                        toolCallId,
                        success: false,
                        output: stdout,
                        error: `命令超时 (${timeout}ms): ${command}`,
                        metadata: createCommandMetadata(command, cwd, timeout, startedAt, new Date()),
                    });
                    return;
                }

                if (code !== 0) {
                    resolve({
                        toolCallId,
                        success: false,
                        output: stdout,
                        error: `命令退出码 ${code}: ${stderr || '未知错误'}`,
                        metadata: createCommandMetadata(command, cwd, timeout, startedAt, new Date()),
                    });
                    return;
                }

                resolve({
                    toolCallId,
                    success: true,
                    output: stdout + (stderr ? `\n[stderr]: ${stderr}` : ''),
                    metadata: createCommandMetadata(command, cwd, timeout, startedAt, new Date()),
                });
            });

            child.on('error', (err) => {
                clearTimeout(timer);
                resolve({
                    toolCallId,
                    success: false,
                    output: '',
                    error: `命令启动失败: ${err.message}`,
                    metadata: createCommandMetadata(command, cwd, timeout, startedAt, new Date()),
                });
            });
        });
    }
}

/**
 * InstallPackageTool
 * 安装 npm/pip 依赖包
 */
export class InstallPackageTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'install_package',
        description: '安装项目依赖包。自动检测项目类型（npm/pip）并使用对应的包管理器。',
        parameters: [
            { name: 'packages', type: 'string', description: '要安装的包名（空格分隔多个包）', required: true },
            { name: 'dev', type: 'boolean', description: '是否作为开发依赖安装（默认 false）', required: false },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>): ToolApprovalRequest {
        const packages = args['packages'] as string;
        const isDev = (args['dev'] as boolean) ?? false;

        return {
            toolCallId: '',
            toolName: 'install_package',
            summary: `安装依赖: ${packages}`,
            reason: isDev ? '将向项目中添加开发依赖。' : '将向项目中添加运行时依赖。',
            preview: packages,
            risk: 'high',
        };
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const packages = args['packages'] as string;
        const isDev = (args['dev'] as boolean) ?? false;
        const toolCallId = (args['toolCallId'] as string) ?? '';

        // 检测包管理器
        const fs = await import('node:fs');
        const path = await import('node:path');

        let command: string;
        let packageManager = 'unknown';

        if (fs.existsSync(path.join(context.cwd, 'package.json'))) {
            // Node.js 项目
            const devFlag = isDev ? '-D' : '';
            if (fs.existsSync(path.join(context.cwd, 'pnpm-lock.yaml'))) {
                packageManager = 'pnpm';
                command = `pnpm add ${devFlag} ${packages}`;
            } else if (fs.existsSync(path.join(context.cwd, 'yarn.lock'))) {
                packageManager = 'yarn';
                command = `yarn add ${isDev ? '--dev' : ''} ${packages}`;
            } else {
                packageManager = 'npm';
                command = `npm install ${isDev ? '--save-dev' : ''} ${packages}`;
            }
        } else if (
            fs.existsSync(path.join(context.cwd, 'requirements.txt')) ||
            fs.existsSync(path.join(context.cwd, 'pyproject.toml'))
        ) {
            // Python 项目
            packageManager = 'pip';
            command = `pip install ${packages}`;
        } else {
            return {
                toolCallId,
                success: false,
                output: '',
                error: '无法检测项目类型，请先初始化项目',
            };
        }

        // 复用 RunCommandTool 执行
        const runTool = new RunCommandTool();
        const result = await runTool.execute(
            { command, toolCallId, timeout: 60000 },
            context,
        );

        return {
            ...result,
            metadata: {
                ...(result.metadata ?? {}),
                packageManager,
                packages,
                dev: isDev,
            },
        };
    }
}

function createCommandMetadata(
    command: string,
    cwd: string,
    timeout: number,
    startedAt: Date,
    completedAt: Date,
): Record<string, unknown> {
    return {
        command,
        cwd,
        timeout,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
    };
}
