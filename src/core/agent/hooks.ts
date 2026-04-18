import { spawn } from 'node:child_process';
import type {
    AgentPermissionMode,
    HookHandlerConfig,
    HookMatcherConfig,
    HookEventName,
    HooksSettings,
    LLMProviderConfig,
    ToolResult,
} from '@xqoder/shared';
import { type Logger, logger as defaultLogger } from '@xqoder/shared';
import { createLLMProvider } from './llm/factory.js';

export type ToolHookEventName = HookEventName;
export type PreToolPermissionDecision = 'allow' | 'ask' | 'deny';

export interface ToolHookRunnerConfig {
    disableAllHooks?: boolean;
    hooks?: HooksSettings;
    llmConfig?: LLMProviderConfig;
    cwd: string;
    projectRoot: string;
    sessionId?: string;
    permissionMode: AgentPermissionMode;
    logger?: Logger;
}

export interface PreToolUseHookPayload {
    hook_event_name: 'PreToolUse';
    session_id?: string;
    cwd: string;
    project_root: string;
    permission_mode: AgentPermissionMode;
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_use_id: string;
}

export interface PostToolUseHookPayload {
    hook_event_name: 'PostToolUse';
    session_id?: string;
    cwd: string;
    project_root: string;
    permission_mode: AgentPermissionMode;
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_use_id: string;
    tool_response: Record<string, unknown>;
}

export interface PostToolUseFailureHookPayload {
    hook_event_name: 'PostToolUseFailure';
    session_id?: string;
    cwd: string;
    project_root: string;
    permission_mode: AgentPermissionMode;
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_use_id: string;
    error: string;
    is_interrupt?: boolean;
}

export type ToolHookPayload =
    | PreToolUseHookPayload
    | PostToolUseHookPayload
    | PostToolUseFailureHookPayload;

export interface HookHandlerExecutionResult {
    type: HookHandlerConfig['type'];
    matched: boolean;
    skipped?: boolean;
    asynchronous?: boolean;
    output?: string;
    error?: string;
}

export interface ToolHookExecutionResult {
    continue: boolean;
    stopReason?: string;
    systemMessages: string[];
    permissionDecision?: PreToolPermissionDecision;
    permissionDecisionReason?: string;
    decision?: 'block';
    reason?: string;
    additionalContexts: string[];
    handlers: HookHandlerExecutionResult[];
}

interface HookHandlerResponse {
    continue?: boolean;
    stopReason?: string;
    suppressOutput?: boolean;
    systemMessage?: string;
    decision?: string;
    reason?: string;
    hookSpecificOutput?: {
        hookEventName?: string;
        permissionDecision?: string;
        permissionDecisionReason?: string;
        additionalContext?: string;
    };
}

const HOOK_PROMPT_SYSTEM = [
    'You are a deterministic runtime hook evaluator.',
    'Return JSON only. Do not include markdown fences or prose.',
    'If no action is needed, return {}.',
    'Allowed top-level fields: continue, stopReason, systemMessage, decision, reason, hookSpecificOutput.',
    'Allowed hookSpecificOutput fields: hookEventName, permissionDecision, permissionDecisionReason, additionalContext.',
].join(' ');

const DEFAULT_HOOK_TIMEOUT_MS = 5_000;
const TOOL_MATCHER_ALIASES: Record<string, string[]> = {
    run_command: ['run_command', 'bash', 'shell'],
    install_package: ['install_package', 'bash', 'shell'],
    read_file: ['read_file', 'read'],
    write_file: ['write_file', 'write', 'edit'],
    apply_patch: ['apply_patch', 'edit', 'patch'],
    preview_diff: ['preview_diff', 'edit', 'diff'],
    restore_rollback_point: ['restore_rollback_point', 'edit', 'rollback'],
    fetch_url: ['fetch_url', 'webfetch'],
    websearch: ['websearch', 'websearchtool'],
    search_code: ['search_code', 'grep'],
    grep_content: ['grep_content', 'grep'],
    glob_files: ['glob_files', 'glob'],
    list_files: ['list_files', 'list', 'ls'],
    delegate_task: ['delegate_task', 'task', 'agent'],
};

export async function runToolHooks(
    eventName: ToolHookEventName,
    payload: ToolHookPayload,
    config: ToolHookRunnerConfig,
): Promise<ToolHookExecutionResult> {
    const logger = config.logger ?? defaultLogger.child('HookRunner');
    const result: ToolHookExecutionResult = {
        continue: true,
        systemMessages: [],
        additionalContexts: [],
        handlers: [],
    };

    if (config.disableAllHooks || !config.hooks || Object.keys(config.hooks).length === 0) {
        return result;
    }

    const matcherGroups = config.hooks[eventName] ?? [];
    for (const matcherGroup of matcherGroups) {
        if (!matchesToolHook(matcherGroup, payload.tool_name)) {
            continue;
        }

        for (const handler of matcherGroup.hooks) {
            const handlerResult = await executeHookHandler(handler, payload, config, eventName, logger);
            result.handlers.push(handlerResult);

            if (handlerResult.error) {
                logger.warn(`Hook handler failed for ${eventName}/${payload.tool_name}: ${handlerResult.error}`);
                continue;
            }

            const parsed = parseHookHandlerOutput(handlerResult.output);
            if (!parsed) {
                continue;
            }

            if (parsed.systemMessage?.trim()) {
                result.systemMessages.push(parsed.systemMessage.trim());
            }
            if (parsed.continue === false) {
                result.continue = false;
                if (!result.stopReason && parsed.stopReason?.trim()) {
                    result.stopReason = parsed.stopReason.trim();
                }
            }
            if (parsed.decision === 'block' && !result.decision) {
                result.decision = 'block';
                if (parsed.reason?.trim()) {
                    result.reason = parsed.reason.trim();
                }
            }

            const hookEventName = parsed.hookSpecificOutput?.hookEventName;
            if (!hookEventName || hookEventName === eventName) {
                const permissionDecision = normalizePermissionDecision(parsed.hookSpecificOutput?.permissionDecision);
                if (permissionDecision) {
                    result.permissionDecision = mergePermissionDecision(result.permissionDecision, permissionDecision);
                    if (!result.permissionDecisionReason && parsed.hookSpecificOutput?.permissionDecisionReason?.trim()) {
                        result.permissionDecisionReason = parsed.hookSpecificOutput.permissionDecisionReason.trim();
                    }
                }

                if (parsed.hookSpecificOutput?.additionalContext?.trim()) {
                    result.additionalContexts.push(parsed.hookSpecificOutput.additionalContext.trim());
                }
            }
        }
    }

    result.additionalContexts = Array.from(new Set(result.additionalContexts));
    result.systemMessages = Array.from(new Set(result.systemMessages));
    return result;
}

export function buildPreToolUseHookPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    permissionMode: AgentPermissionMode;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
}): PreToolUseHookPayload {
    return {
        hook_event_name: 'PreToolUse',
        session_id: input.sessionId,
        cwd: input.cwd,
        project_root: input.projectRoot,
        permission_mode: input.permissionMode,
        tool_name: input.toolName,
        tool_input: input.toolInput,
        tool_use_id: input.toolUseId,
    };
}

export function buildPostToolUseHookPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    permissionMode: AgentPermissionMode;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
    toolResult: ToolResult;
}): PostToolUseHookPayload {
    return {
        hook_event_name: 'PostToolUse',
        session_id: input.sessionId,
        cwd: input.cwd,
        project_root: input.projectRoot,
        permission_mode: input.permissionMode,
        tool_name: input.toolName,
        tool_input: input.toolInput,
        tool_use_id: input.toolUseId,
        tool_response: {
            success: input.toolResult.success,
            output: input.toolResult.output,
            ...(input.toolResult.error ? { error: input.toolResult.error } : {}),
            ...(input.toolResult.metadata ? { metadata: input.toolResult.metadata } : {}),
        },
    };
}

export function buildPostToolUseFailureHookPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    permissionMode: AgentPermissionMode;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
    toolResult: ToolResult;
}): PostToolUseFailureHookPayload {
    return {
        hook_event_name: 'PostToolUseFailure',
        session_id: input.sessionId,
        cwd: input.cwd,
        project_root: input.projectRoot,
        permission_mode: input.permissionMode,
        tool_name: input.toolName,
        tool_input: input.toolInput,
        tool_use_id: input.toolUseId,
        error: input.toolResult.error ?? 'Unknown tool failure',
    };
}

export function formatHookFeedbackSection(label: string, values: string[]): string | undefined {
    const normalized = values
        .map((value) => value.trim())
        .filter(Boolean);
    if (normalized.length === 0) {
        return undefined;
    }

    return [
        `${label}:`,
        ...normalized,
    ].join('\n');
}

async function executeHookHandler(
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
                error: `Unsupported hook handler type: ${String((handler as HookHandlerConfig).type)}`,
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
    if (handler.async && eventName !== 'PreToolUse') {
        try {
            const shellPath = handler.shell ?? process.env['SHELL'] ?? '/bin/sh';
            const child = spawn(shellPath, ['-lc', handler.command], {
                cwd: config.cwd,
                env: createHookEnvironment(config, payload),
                stdio: ['pipe', 'ignore', 'ignore'],
            });
            child.stdin.end(JSON.stringify(payload));
            child.unref();
            return {
                type: handler.type,
                matched: true,
                asynchronous: true,
            };
        } catch (error) {
            logger.warn(`Async hook spawn failed: ${error instanceof Error ? error.message : String(error)}`);
            return {
                type: handler.type,
                matched: true,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    try {
        const output = await withTimeout(runCommandHookProcess(handler, payload, config), timeoutMs, 'Command hook timed out');
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
    handler: Extract<HookHandlerConfig, { type: 'command' }>,
    payload: ToolHookPayload,
    config: ToolHookRunnerConfig,
): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        const shellPath = handler.shell ?? process.env['SHELL'] ?? '/bin/sh';
        const child = spawn(shellPath, ['-lc', handler.command], {
            cwd: config.cwd,
            env: createHookEnvironment(config, payload),
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer | string) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer | string) => {
            stderr += chunk.toString();
        });
        child.on('error', (error) => {
            reject(error);
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

function parseHookHandlerOutput(output: string | undefined): HookHandlerResponse | null {
    if (!output?.trim()) {
        return null;
    }

    const parsedText = extractJsonObject(output);
    if (!parsedText) {
        return null;
    }

    try {
        const parsed = JSON.parse(parsedText) as HookHandlerResponse;
        return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
        return null;
    }
}

function extractJsonObject(output: string): string | null {
    const trimmed = output.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        return trimmed;
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        return fenced[1].trim();
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) {
        return null;
    }
    return trimmed.slice(start, end + 1);
}

function createHookEnvironment(config: ToolHookRunnerConfig, payload: ToolHookPayload): Record<string, string> {
    return {
        ...Object.fromEntries(
            Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        ),
        CLAUDE_PROJECT_DIR: config.projectRoot,
        CLAUDE_CWD: config.cwd,
        XQODER_PROJECT_DIR: config.projectRoot,
        XQODER_CWD: config.cwd,
        XQODER_HOOK_EVENT_NAME: payload.hook_event_name,
        ...(config.sessionId ? { XQODER_SESSION_ID: config.sessionId } : {}),
    };
}

function matchesToolHook(matcherGroup: HookMatcherConfig, toolName: string): boolean {
    const matcher = matcherGroup.matcher?.trim();
    if (!matcher || matcher === '*') {
        return true;
    }

    const normalizedMatcher = matcher.toLowerCase();
    const aliases = new Set([
        toolName.toLowerCase(),
        ...(TOOL_MATCHER_ALIASES[toolName] ?? []).map((entry) => entry.toLowerCase()),
    ]);
    if (aliases.has(normalizedMatcher)) {
        return true;
    }

    if (!normalizedMatcher.includes('*')) {
        return false;
    }

    const pattern = new RegExp(`^${escapeRegExp(normalizedMatcher).replace(/\\\*/g, '.*')}$`, 'i');
    return Array.from(aliases).some((alias) => pattern.test(alias));
}

function mergePermissionDecision(
    current: PreToolPermissionDecision | undefined,
    next: PreToolPermissionDecision,
): PreToolPermissionDecision {
    if (!current) {
        return next;
    }
    const rank: Record<PreToolPermissionDecision, number> = {
        allow: 1,
        ask: 2,
        deny: 3,
    };
    return rank[next] > rank[current] ? next : current;
}

function normalizePermissionDecision(value: string | undefined): PreToolPermissionDecision | undefined {
    if (value === 'allow' || value === 'ask' || value === 'deny') {
        return value;
    }
    return undefined;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
