import { spawn } from 'node:child_process';
import type { HookHandlerConfig, Logger } from '@xqoder/shared';
import { createLLMProvider } from './llm/factory.js';
import { filterSensitiveEnv } from './tools/env-filter.js';
import type {
    HookHandlerExecutionResult,
    ToolHookEventName,
    ToolHookPayload,
    ToolHookRunnerConfig,
} from './hooks.js';

const HOOK_PROMPT_SYSTEM = [
    'You are a deterministic runtime hook evaluator.',
    'Return JSON only. Do not include markdown fences or prose.',
    'If no action is needed, return {}.',
    'Allowed top-level fields: continue, stopReason, systemMessage, decision, reason, hookSpecificOutput.',
    'Allowed hookSpecificOutput fields: hookEventName, permissionDecision, permissionDecisionReason, additionalContext.',
].join(' ');

const DEFAULT_HOOK_TIMEOUT_MS = 5_000;

export interface CommandHookShellSpec {
    shellPath: string;
    shellArgs: string[];
}

export async function executeHookHandler(
    handler: HookHandlerConfig,
    payload: ToolHookPayload,
    config: ToolHookRunnerConfig,
    eventName: ToolHookEventName,
    logger: Logger,
): Promise<HookHandlerExecutionResult> {
    switch (handler.type) {
        case 'command':
            return executeCommandHook(handler, payload, config, eventName, logger);
        case 'http':
            return executeHttpHook(handler, payload, logger);
        case 'prompt':
            return executePromptHook(handler.prompt, handler.model, undefined, payload, config, logger, 'prompt');
        case 'agent':
            return executePromptHook(handler.prompt, handler.model, handler.agent, payload, config, logger, 'agent');
        default:
            return {
                type: 'command',
                matched: true,
                error: 'Unsupported hook handler type',
            };
    }
}

async function executeCommandHook(
    handler: Extract<HookHandlerConfig, { type: 'command' }>,
    payload: ToolHookPayload,
    config: ToolHookRunnerConfig,
    eventName: ToolHookEventName,
    logger: Logger,
): Promise<HookHandlerExecutionResult> {
    const timeoutMs = handler.timeout ?? DEFAULT_HOOK_TIMEOUT_MS;
    const shellSpec = resolveCommandHookShellSpec({
        command: handler.command,
        configuredShell: handler.shell,
        envShell: process.env['SHELL'],
        platform: process.platform,
    });

    if (handler.async && eventName !== 'PreToolUse') {
        try {
            const child = spawnHookProcess(shellSpec, payload, config, ['pipe', 'ignore', 'ignore']);
            if (!child.stdin) {
                throw new Error(`Failed to start hook shell "${shellSpec.shellPath}": stdin pipe unavailable`);
            }
            child.stdin.end(JSON.stringify(payload));
            await waitForHookProcessStart(child, shellSpec.shellPath);
            child.unref();
            return {
                type: handler.type,
                matched: true,
                asynchronous: true,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`Async hook spawn failed: ${message}`);
            return {
                type: handler.type,
                matched: true,
                error: message,
            };
        }
    }

    try {
        const output = await withTimeout(runCommandHookProcess(shellSpec, payload, config), timeoutMs, 'Command hook timed out');
        return {
            type: handler.type,
            matched: true,
            output,
        };
    } catch (error) {
        return {
            type: handler.type,
            matched: true,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function runCommandHookProcess(
    shellSpec: CommandHookShellSpec,
    payload: ToolHookPayload,
    config: ToolHookRunnerConfig,
): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        const child = spawnHookProcess(shellSpec, payload, config, ['pipe', 'pipe', 'pipe']);
        if (!child.stdin || !child.stdout || !child.stderr) {
            reject(new Error(`Failed to start hook shell "${shellSpec.shellPath}": stdio pipes unavailable`));
            return;
        }

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer | string) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer | string) => {
            stderr += chunk.toString();
        });
        child.on('error', (error) => {
            reject(toHookShellStartError(error, shellSpec.shellPath));
        });
        child.on('close', (code) => {
            if (code && code !== 0 && stdout.trim().length === 0) {
                reject(new Error(stderr.trim() || `Hook exited with status ${code}`));
                return;
            }
            resolve(stdout.trim());
        });

        child.stdin.end(JSON.stringify(payload));
    });
}

export function resolveCommandHookShellSpec(input: {
    command: string;
    configuredShell?: string;
    envShell?: string;
    platform?: NodeJS.Platform;
}): CommandHookShellSpec {
    const platform = input.platform ?? process.platform;
    const shellPath = normalizeHookShellPath(input.configuredShell)
        ?? normalizeHookShellPath(input.envShell)
        ?? getDefaultHookShellPath(platform);

    return {
        shellPath,
        shellArgs: createHookShellArgs(shellPath, input.command),
    };
}

async function executeHttpHook(
    handler: Extract<HookHandlerConfig, { type: 'http' }>,
    payload: ToolHookPayload,
    logger: Logger,
): Promise<HookHandlerExecutionResult> {
    const controller = new AbortController();
    const timeoutMs = handler.timeout ?? DEFAULT_HOOK_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(handler.url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(handler.headers ?? {}),
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        const text = (await response.text()).trim();
        if (!response.ok) {
            logger.warn(`HTTP hook failed with status ${response.status} for ${handler.url}`);
            return {
                type: handler.type,
                matched: true,
                error: text || `HTTP hook failed with status ${response.status}`,
            };
        }
        return {
            type: handler.type,
            matched: true,
            output: text,
        };
    } catch (error) {
        return {
            type: handler.type,
            matched: true,
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

async function executePromptHook(
    prompt: string,
    model: string | undefined,
    agentName: string | undefined,
    payload: ToolHookPayload,
    config: ToolHookRunnerConfig,
    logger: Logger,
    type: 'prompt' | 'agent',
): Promise<HookHandlerExecutionResult> {
    if (!config.llmConfig) {
        return {
            type,
            matched: true,
            error: 'No llmConfig available for prompt-based hook execution',
        };
    }

    try {
        const provider = await createLLMProvider({
            ...config.llmConfig,
            ...(model?.trim() ? { model: model.trim() } : {}),
        });
        const response = await withTimeout(provider.complete({
            messages: [
                {
                    role: 'system',
                    content: [
                        HOOK_PROMPT_SYSTEM,
                        agentName?.trim()
                            ? `Use the reasoning style of agent "${agentName.trim()}" while still returning JSON only.`
                            : undefined,
                    ].filter(Boolean).join(' '),
                },
                {
                    role: 'user',
                    content: [
                        prompt,
                        '',
                        'Hook event payload:',
                        JSON.stringify(payload, null, 2),
                    ].join('\n'),
                },
            ],
            maxTokens: 1024,
            temperature: 0,
        }), DEFAULT_HOOK_TIMEOUT_MS, 'Prompt hook timed out');
        return {
            type,
            matched: true,
            output: response.message.content?.trim() ?? '',
        };
    } catch (error) {
        logger.warn(`Prompt hook failed: ${error instanceof Error ? error.message : String(error)}`);
        return {
            type,
            matched: true,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function createHookEnvironment(config: ToolHookRunnerConfig, payload: ToolHookPayload): Record<string, string> {
    const explicit: Record<string, string> = {
        CLAUDE_PROJECT_DIR: config.projectRoot,
        CLAUDE_CWD: config.cwd,
        XQODER_PROJECT_DIR: config.projectRoot,
        XQODER_CWD: config.cwd,
        XQODER_HOOK_EVENT_NAME: payload.hook_event_name,
        ...(config.sessionId ? { XQODER_SESSION_ID: config.sessionId } : {}),
    };
    return filterSensitiveEnv(process.env, explicit);
}

function spawnHookProcess(
    shellSpec: CommandHookShellSpec,
    payload: ToolHookPayload,
    config: ToolHookRunnerConfig,
    stdio: ['pipe', 'ignore', 'ignore'] | ['pipe', 'pipe', 'pipe'],
) {
    try {
        return spawn(shellSpec.shellPath, shellSpec.shellArgs, {
            cwd: config.cwd,
            env: createHookEnvironment(config, payload),
            stdio,
        });
    } catch (error) {
        throw toHookShellStartError(error, shellSpec.shellPath);
    }
}

function waitForHookProcessStart(child: ReturnType<typeof spawn>, shellPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const handleSpawn = () => {
            cleanup();
            resolve();
        };
        const handleError = (error: Error) => {
            cleanup();
            reject(toHookShellStartError(error, shellPath));
        };
        const cleanup = () => {
            child.off('spawn', handleSpawn);
            child.off('error', handleError);
        };

        child.once('spawn', handleSpawn);
        child.once('error', handleError);
    });
}

function toHookShellStartError(error: unknown, shellPath: string): Error {
    const detail = error instanceof Error ? error.message : String(error);
    const message = detail.startsWith('Failed to start hook shell')
        ? detail
        : `Failed to start hook shell "${shellPath}": ${detail}`;
    return new Error(message);
}

function normalizeHookShellPath(shellPath: string | undefined): string | undefined {
    const trimmed = shellPath?.trim();
    return trimmed ? trimmed : undefined;
}

function getDefaultHookShellPath(platform: NodeJS.Platform): string {
    return platform === 'win32' ? 'cmd.exe' : 'sh';
}

function createHookShellArgs(shellPath: string, command: string): string[] {
    const shellName = getShellName(shellPath);
    if (shellName === 'cmd' || shellName === 'cmd.exe') {
        return ['/d', '/s', '/c', command];
    }
    if (shellName === 'powershell' || shellName === 'powershell.exe' || shellName === 'pwsh' || shellName === 'pwsh.exe') {
        return ['-NoLogo', '-NoProfile', '-Command', command];
    }
    return ['-c', command];
}

function getShellName(shellPath: string): string {
    const parts = shellPath.split(/[\\/]/);
    const name = parts.at(-1) ?? shellPath;
    return name.toLowerCase();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timeoutId);
                resolve(value);
            },
            (error) => {
                clearTimeout(timeoutId);
                reject(error);
            },
        );
    });
}
