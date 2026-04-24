// ============================================================
// Command Execution Tool
// ============================================================

import * as fs from 'node:fs';
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

const SENTINEL_PREFIX = '___XQODER_SENTINEL___';
const EXIT_CODE_PREFIX = '___XQODER_EXIT_CODE___';
const SHELL_SYNTAX_PATTERN = /[;&|`$><(){}"'\\]/;

export interface InstallPackageExecutionPlan {
    packageManager: 'bun' | 'pnpm' | 'yarn' | 'npm' | 'pip';
    executable: string;
    args: string[];
    packageSpecifiers: string[];
    commandForDisplay: string;
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

    private stdoutBuffer = '';
    private stderrBuffer = '';
    private currentResolve: ((res: CommandExecutionResult) => void) | null = null;
    private currentSentinel = '';
    private currentExitCode = 0;
    private currentInterrupted = false;

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

        proc.stdout.on('data', (data: Buffer) => {
            const chunk = data.toString('utf-8');
            if (this.currentResolve) {
                this.handleStdout(chunk);
            }
        });
        proc.stderr.on('data', (data: Buffer) => {
            const chunk = data.toString('utf-8');
            if (this.currentResolve) {
                this.stderrBuffer += chunk;
            }
        });
        proc.once('exit', () => {
            this.handleUnexpectedExit();
        });
        proc.once('error', (err) => {
            this.handleUnexpectedExit(err);
        });

        this.process = proc;
        this.alive = true;
    }

    private handleStdout(chunk: string): void {
        this.stdoutBuffer += chunk;

        if (this.stdoutBuffer.includes(this.currentSentinel)) {
            // Parse exit code
            const exitMatch = this.stdoutBuffer.match(new RegExp(`${EXIT_CODE_PREFIX}(\\d+)`));
            if (exitMatch?.[1]) {
                this.currentExitCode = parseInt(exitMatch[1], 10);
            }

            // Clean buffer
            const sentinelIndex = this.stdoutBuffer.indexOf(this.currentSentinel);
            let finalStdout = this.stdoutBuffer.slice(0, sentinelIndex);
            
            // Further clean leading exit code markers
            const exitIndex = finalStdout.lastIndexOf(EXIT_CODE_PREFIX);
            if (exitIndex !== -1) {
                finalStdout = finalStdout.slice(0, exitIndex);
            }

            this.finishCommand(finalStdout.trimEnd());
        }
    }

    private finishCommand(finalStdout: string): void {
        if (this.currentResolve) {
            this.currentResolve({
                stdout: finalStdout,
                stderr: this.stderrBuffer.trimEnd(),
                exitCode: this.currentExitCode,
                interrupted: this.currentInterrupted,
            });
            this.currentResolve = null;
        }
    }

    private handleUnexpectedExit(err?: Error): void {
        this.alive = false;
        this.process = undefined;
        if (this.currentResolve) {
            this.currentResolve({
                stdout: this.stdoutBuffer,
                stderr: this.stderrBuffer + (err ? `\nShell crashed: ${err.message}` : '\nShell exited unexpectedly'),
                exitCode: 1,
                interrupted: false,
                err: err || new Error('Shell process exited'),
            });
            this.currentResolve = null;
        }
    }

    private async executeSerial(command: string, timeout: number): Promise<CommandExecutionResult> {
        return new Promise((resolve) => {
            try {
                this.ensureProcess();
                if (!this.process || !this.alive) {
                    return resolve({
                        stdout: '',
                        stderr: 'Shell is not available',
                        exitCode: 1,
                        interrupted: false,
                        err: new Error('Shell is not available'),
                    });
                }

                // Initialize state
                const uuid = Math.random().toString(36).slice(2, 10);
                this.currentSentinel = `${SENTINEL_PREFIX}${uuid}`;
                this.stdoutBuffer = '';
                this.stderrBuffer = '';
                this.currentExitCode = 0;
                this.currentInterrupted = false;
                this.currentResolve = resolve;

                // Build sentinel command
                // We append: record exit code -> print exit code -> print sentinel
                const wrappedCommand = `${command}\n` +
                    `_XQ_EXIT=$?; echo "${EXIT_CODE_PREFIX}$_XQ_EXIT"; echo "${this.currentSentinel}"\n`;

                this.process.stdin.write(wrappedCommand);

                // Timeout control
                setTimeout(() => {
                    if (this.currentResolve === resolve) {
                        this.currentInterrupted = true;
                        this.terminate();
                        this.finishCommand(this.stdoutBuffer + '\n[Timeout]');
                    }
                }, timeout);

            } catch (err) {
                resolve({
                    stdout: '',
                    stderr: `Failed to execute: ${err instanceof Error ? err.message : String(err)}`,
                    exitCode: 1,
                    interrupted: false,
                    err: err instanceof Error ? err : new Error(String(err)),
                });
            }
        });
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
 * Executes commands in the terminal and returns output
 */
export class RunCommandTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'run_command',
        description: 'Execute shell commands in the terminal. Use it to install dependencies, run scripts, execute builds, and other tasks.',
        parameters: [
            { name: 'command', type: 'string', description: 'The shell command to execute', required: true },
            { name: 'cwd', type: 'string', description: 'Working directory (optional, defaults to project root)', required: false },
            { name: 'timeout', type: 'number', description: 'Timeout in milliseconds (default 30000)', required: false },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>): ToolApprovalRequest {
        const command = args['command'] as string;
        return buildShellApprovalRequest(this.definition.name, command);
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        return executeShellTool(args, context);
    }
}

export class RunShellTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'run_shell',
        description: 'Execute shell commands in the terminal. Use it for test, lint, build, or targeted runtime checks.',
        parameters: [
            { name: 'command', type: 'string', description: 'The shell command to execute', required: true },
            { name: 'cwd', type: 'string', description: 'Working directory (optional, defaults to project root)', required: false },
            { name: 'timeout', type: 'number', description: 'Timeout in milliseconds (default 30000)', required: false },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>): ToolApprovalRequest {
        const command = args['command'] as string;
        return buildShellApprovalRequest(this.definition.name, command);
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        return executeShellTool(args, context);
    }
}

/**
 * InstallPackageTool
 * Installs npm/pip dependency packages
 */
export class InstallPackageTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'install_package',
        description: 'Install project dependency packages. Automatically detects project type (npm/pip) and uses the corresponding package manager.',
        parameters: [
            { name: 'packages', type: 'string', description: 'Package names to install (space-separated for multiple packages)', required: true },
            { name: 'dev', type: 'boolean', description: 'Whether to install as a development dependency (default false)', required: false },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>): ToolApprovalRequest {
        const packages = args['packages'] as string;
        const isDev = (args['dev'] as boolean) ?? false;

        return {
            toolCallId: '',
            toolName: 'install_package',
            summary: `Install dependency: ${packages}`,
            reason: isDev ? 'Will add a development dependency to the project.' : 'Will add a runtime dependency to the project.',
            preview: packages,
            risk: 'high',
        };
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const packages = args['packages'] as string;
        const isDev = (args['dev'] as boolean) ?? false;
        const toolCallId = (args['toolCallId'] as string) ?? '';

        let executionPlan: InstallPackageExecutionPlan;
        try {
            executionPlan = resolveInstallPackageExecution({
                cwd: context.cwd,
                packages,
                dev: isDev,
            });
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: err instanceof Error ? err.message : String(err),
            };
        }

        const result = await executeDirectCommand(
            {
                executable: executionPlan.executable,
                args: executionPlan.args,
                cwd: context.cwd,
                timeout: 60000,
                commandForDisplay: executionPlan.commandForDisplay,
            },
            context,
            toolCallId,
        );

        return {
            ...result,
            metadata: {
                ...(result.metadata ?? {}),
                packageManager: executionPlan.packageManager,
                packages,
                packageSpecifiers: executionPlan.packageSpecifiers,
                dev: isDev,
                executable: executionPlan.executable,
                argv: executionPlan.args,
            },
        };
    }
}

export function resolveInstallPackageExecution(input: {
    cwd: string;
    packages: string;
    dev?: boolean;
}): InstallPackageExecutionPlan {
    const packageSpecifiers = parseInstallPackageSpecifiers(input.packages);
    const isDev = input.dev ?? false;

    if (fs.existsSync(path.join(input.cwd, 'package.json'))) {
        if (fs.existsSync(path.join(input.cwd, 'bun.lock')) || fs.existsSync(path.join(input.cwd, 'bun.lockb'))) {
            return createInstallPackageExecutionPlan('bun', ['add', ...(isDev ? ['-d'] : []), ...packageSpecifiers], packageSpecifiers);
        }
        if (fs.existsSync(path.join(input.cwd, 'pnpm-lock.yaml'))) {
            return createInstallPackageExecutionPlan('pnpm', ['add', ...(isDev ? ['-D'] : []), ...packageSpecifiers], packageSpecifiers);
        }
        if (fs.existsSync(path.join(input.cwd, 'yarn.lock'))) {
            return createInstallPackageExecutionPlan('yarn', ['add', ...(isDev ? ['--dev'] : []), ...packageSpecifiers], packageSpecifiers);
        }
        return createInstallPackageExecutionPlan('npm', ['install', ...(isDev ? ['--save-dev'] : []), ...packageSpecifiers], packageSpecifiers);
    }

    if (
        fs.existsSync(path.join(input.cwd, 'requirements.txt'))
        || fs.existsSync(path.join(input.cwd, 'pyproject.toml'))
    ) {
        return createInstallPackageExecutionPlan('pip', ['install', ...packageSpecifiers], packageSpecifiers);
    }

    throw new Error('Unable to detect project type, please initialize the project first');
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

function buildShellApprovalRequest(toolName: string, command: string): ToolApprovalRequest {
    return {
        toolCallId: '',
        toolName,
        summary: `Execute command: ${command}`,
        reason: 'Shell commands directly affect the project environment or file system.',
        preview: command,
        risk: 'high',
    };
}

async function executeShellTool(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
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
            error: `Command timed out (${timeout}ms): ${command}`,
            metadata: createCommandMetadata(command, cwd, timeout, startedAt, completedAt),
        };
    }

    if (result.err) {
        return {
            toolCallId,
            success: false,
            output: result.stdout,
            error: `Command failed to start: ${result.err.message}`,
            metadata: createCommandMetadata(command, cwd, timeout, startedAt, completedAt),
        };
    }

    if (result.exitCode !== 0) {
        return {
            toolCallId,
            success: false,
            output: result.stdout,
            error: `Command exited with code ${result.exitCode}: ${result.stderr || 'Unknown error'}`,
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

async function executeDirectCommand(
    input: {
        executable: string;
        args: string[];
        cwd: string;
        timeout: number;
        commandForDisplay: string;
    },
    context: ToolContext,
    toolCallId: string,
): Promise<ToolResult> {
    const startedAt = new Date();

    return await new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let completed = false;
        let interrupted = false;

        const finish = (result: ToolResult, completedAt: Date): void => {
            if (completed) {
                return;
            }
            completed = true;
            clearTimeout(timeoutId);
            resolve({
                ...result,
                metadata: {
                    ...createCommandMetadata(input.commandForDisplay, input.cwd, input.timeout, startedAt, completedAt),
                    ...(result.metadata ?? {}),
                },
            });
        };

        const child = spawn(input.executable, input.args, {
            cwd: input.cwd,
            env: {
                ...process.env,
                ...context.env,
                GIT_EDITOR: 'true',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout?.on('data', (data: Buffer) => {
            const chunk = data.toString('utf-8');
            stdout += chunk;
            context.onToolStream?.({
                chunk,
                stream: 'stdout',
            });
        });

        child.stderr?.on('data', (data: Buffer) => {
            const chunk = data.toString('utf-8');
            stderr += chunk;
            context.onToolStream?.({
                chunk,
                stream: 'stderr',
            });
        });

        child.once('error', (err) => {
            finish({
                toolCallId,
                success: false,
                output: stdout.trimEnd(),
                error: `Command failed to start: ${err.message}`,
            }, new Date());
        });

        child.once('close', (exitCode, signal) => {
            const completedAt = new Date();
            const trimmedStdout = stdout.trimEnd();
            const trimmedStderr = stderr.trimEnd();

            if (interrupted) {
                finish({
                    toolCallId,
                    success: false,
                    output: trimmedStdout,
                    error: `Command timed out (${input.timeout}ms): ${input.commandForDisplay}`,
                }, completedAt);
                return;
            }

            if (signal && exitCode === null) {
                finish({
                    toolCallId,
                    success: false,
                    output: trimmedStdout,
                    error: `Command exited with signal ${signal}: ${input.commandForDisplay}`,
                }, completedAt);
                return;
            }

            if ((exitCode ?? 1) !== 0) {
                finish({
                    toolCallId,
                    success: false,
                    output: trimmedStdout,
                    error: `Command exited with code ${exitCode ?? 1}: ${trimmedStderr || 'Unknown error'}`,
                }, completedAt);
                return;
            }

            finish({
                toolCallId,
                success: true,
                output: trimmedStdout + (trimmedStderr ? `\n[stderr]: ${trimmedStderr}` : ''),
            }, completedAt);
        });

        const timeoutId = setTimeout(() => {
            interrupted = true;
            child.kill('SIGTERM');
        }, input.timeout);
    });
}

function createInstallPackageExecutionPlan(
    packageManager: InstallPackageExecutionPlan['packageManager'],
    args: string[],
    packageSpecifiers: string[],
): InstallPackageExecutionPlan {
    return {
        packageManager,
        executable: packageManager,
        args,
        packageSpecifiers,
        commandForDisplay: formatCommandForDisplay(packageManager, args),
    };
}

function parseInstallPackageSpecifiers(packages: string): string[] {
    if (/[\x00-\x1F\x7F]/.test(packages)) {
        throw new Error('Package list contains control characters; pass package specifiers separated by spaces only');
    }

    if (SHELL_SYNTAX_PATTERN.test(packages)) {
        throw new Error('Package list contains unsupported shell syntax; pass package specifiers separated by spaces only');
    }

    const packageSpecifiers = packages
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (packageSpecifiers.length === 0) {
        throw new Error('Package list cannot be empty');
    }

    return packageSpecifiers;
}

function formatCommandForDisplay(executable: string, args: string[]): string {
    return [executable, ...args]
        .map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg)
        .join(' ');
}
