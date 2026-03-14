// ============================================================
// 命令执行工具
// ============================================================

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolApprovalRequest, ToolContext } from './tool.js';
import { isSandboxAccessError, resolveWorkingDirectory, validateCommandSafety } from './sandbox.js';

interface CommandExecutionResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    interrupted: boolean;
    err?: Error;
}

class PersistentShell {
    private readonly shellPath: string;
    private readonly shellArgs: string[];
    private readonly env: Record<string, string | undefined>;
    private readonly cwd: string;
    private process: ChildProcessWithoutNullStreams | undefined;
    private alive = false;
    private queue: Promise<CommandExecutionResult> = Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 0,
        interrupted: false,
    });

    constructor(options: {
        shellPath: string;
        shellArgs: string[];
        cwd: string;
        env: Record<string, string | undefined>;
    }) {
        this.shellPath = options.shellPath;
        this.shellArgs = options.shellArgs;
        this.cwd = options.cwd;
        this.env = options.env;
    }

    async execute(command: string, timeout: number): Promise<CommandExecutionResult> {
        const run = this.queue.then(() => this.executeSerial(command, timeout));
        this.queue = run.catch(() => ({
            stdout: '',
            stderr: '',
            exitCode: 1,
            interrupted: false,
        }));
        return run;
    }

    terminate(): void {
        if (this.process && this.alive) {
            this.process.kill('SIGTERM');
        }
        this.process = undefined;
        this.alive = false;
    }

    isAlive(): boolean {
        return this.alive;
    }

    private ensureProcess(): void {
        if (this.process && this.alive) {
            return;
        }

        const proc = spawn(this.shellPath, this.shellArgs, {
            cwd: this.cwd,
            env: {
                ...process.env,
                ...this.env,
                GIT_EDITOR: 'true',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        proc.stdout.on('data', () => {
            // Drain shell stdout to avoid pipe backpressure.
        });
        proc.stderr.on('data', () => {
            // Drain shell stderr to avoid pipe backpressure.
        });
        proc.once('exit', () => {
            this.alive = false;
            this.process = undefined;
        });
        proc.once('error', () => {
            this.alive = false;
            this.process = undefined;
        });

        this.process = proc;
        this.alive = true;
    }

    private async executeSerial(command: string, timeout: number): Promise<CommandExecutionResult> {
        try {
            this.ensureProcess();
        } catch (err) {
            return {
                stdout: '',
                stderr: '',
                exitCode: 1,
                interrupted: false,
                err: err instanceof Error ? err : new Error(String(err)),
            };
        }

        if (!this.process || !this.alive) {
            return {
                stdout: '',
                stderr: 'Shell is not available',
                exitCode: 1,
                interrupted: false,
                err: new Error('Shell is not available'),
            };
        }

        const tempPrefix = `xqoder-shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const tempDir = os.tmpdir();
        const stdoutFile = path.join(tempDir, `${tempPrefix}-stdout.log`);
        const stderrFile = path.join(tempDir, `${tempPrefix}-stderr.log`);
        const statusFile = path.join(tempDir, `${tempPrefix}-status.log`);
        const cwdFile = path.join(tempDir, `${tempPrefix}-cwd.log`);

        const fullCommand = `
eval ${shellQuote(command)} < /dev/null > ${shellQuote(stdoutFile)} 2> ${shellQuote(stderrFile)}
EXEC_EXIT_CODE=$?
pwd > ${shellQuote(cwdFile)}
echo $EXEC_EXIT_CODE > ${shellQuote(statusFile)}
`;

        try {
            this.process.stdin.write(`${fullCommand}\n`);
        } catch (err) {
            this.terminate();
            return {
                stdout: '',
                stderr: `Failed to write command to shell: ${err instanceof Error ? err.message : String(err)}`,
                exitCode: 1,
                interrupted: false,
                err: err instanceof Error ? err : new Error(String(err)),
            };
        }

        const startedAt = Date.now();
        let interrupted = false;

        while (true) {
            if (fileHasContent(statusFile)) {
                break;
            }

            if (Date.now() - startedAt > timeout) {
                interrupted = true;
                this.terminate();
                break;
            }

            await sleep(15);
        }

        const stdout = safeReadFile(stdoutFile);
        const stderr = safeReadFile(stderrFile);
        const statusRaw = safeReadFile(statusFile).trim();
        const parsed = Number.parseInt(statusRaw, 10);
        const exitCode = Number.isFinite(parsed) ? parsed : 1;

        safeUnlink(stdoutFile);
        safeUnlink(stderrFile);
        safeUnlink(statusFile);
        safeUnlink(cwdFile);

        return {
            stdout,
            stderr,
            exitCode,
            interrupted,
        };
    }
}

const persistentShells = new Map<string, PersistentShell>();

function getPersistentShell(context: ToolContext, cwd: string): PersistentShell {
    const shellPath = context.shell?.path ?? process.env.SHELL ?? '/bin/sh';
    const shellArgs = context.shell?.args ?? ['-l'];
    const key = context.sessionId ? `session:${context.sessionId}` : `cwd:${cwd}`;
    const existing = persistentShells.get(key);

    if (existing && existing.isAlive()) {
        return existing;
    }

    const shell = new PersistentShell({
        shellPath,
        shellArgs,
        cwd,
        env: context.env ?? {},
    });
    persistentShells.set(key, shell);
    return shell;
}

export function resetPersistentShellsForTests(): void {
    for (const shell of persistentShells.values()) {
        shell.terminate();
    }
    persistentShells.clear();
}

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

        const safetyError = validateCommandSafety(command);
        if (safetyError) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: safetyError,
                metadata: createCommandMetadata(command, context.cwd, timeout, startedAt, new Date()),
            };
        }

        try {
            cwd = resolveWorkingDirectory(args['cwd'] as string | undefined, context);
        } catch (err) {
            if (isSandboxAccessError(err)) {
                throw err;
            }
            return {
                toolCallId,
                success: false,
                output: '',
                error: err instanceof Error ? err.message : String(err),
                metadata: createCommandMetadata(command, context.cwd, timeout, startedAt, new Date()),
            };
        }

        const shell = getPersistentShell(context, cwd);
        const result = await shell.execute(command, timeout);
        const completedAt = new Date();

        if (result.stdout) {
            context.onToolStream?.({
                chunk: result.stdout,
                stream: 'stdout',
            });
        }
        if (result.stderr) {
            context.onToolStream?.({
                chunk: result.stderr,
                stream: 'stderr',
            });
        }

        if (result.interrupted) {
            return {
                toolCallId,
                success: false,
                output: result.stdout,
                error: `命令超时 (${timeout}ms): ${command}`,
                metadata: createCommandMetadata(command, cwd, timeout, startedAt, completedAt),
            };
        }

        if (result.err) {
            return {
                toolCallId,
                success: false,
                output: result.stdout,
                error: `命令启动失败: ${result.err.message}`,
                metadata: createCommandMetadata(command, cwd, timeout, startedAt, completedAt),
            };
        }

        if (result.exitCode !== 0) {
            return {
                toolCallId,
                success: false,
                output: result.stdout,
                error: `命令退出码 ${result.exitCode}: ${result.stderr || '未知错误'}`,
                metadata: createCommandMetadata(command, cwd, timeout, startedAt, completedAt),
            };
        }

        return {
            toolCallId,
            success: true,
            output: result.stdout + (result.stderr ? `\n[stderr]: ${result.stderr}` : ''),
            metadata: createCommandMetadata(command, cwd, timeout, startedAt, completedAt),
        };
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

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function fileHasContent(filePath: string): boolean {
    try {
        return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
    } catch {
        return false;
    }
}

function safeReadFile(filePath: string): string {
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return '';
    }
}

function safeUnlink(filePath: string): void {
    try {
        fs.unlinkSync(filePath);
    } catch {
        // ignore
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
