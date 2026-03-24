import {
    AgentSession,
    DEFAULT_SYSTEM_PROMPT,
    TitleAgent,
    buildAgentConfigFromXQoderConfig,
    type AgentConfig,
} from '@xqoder/agent';
import {
    configManager,
    globalEventBus,
    resolveConfigWithEnvOverrides,
    resolveToolPermissionMode,
    type DebugLogger,
    type LLMProviderConfig,
    type MessageAttachment as SharedMessageAttachment,
    type PermissionSettings,
} from '@xqoder/shared';
import type { QuestionAnswer, QuestionPrompt, RuntimeDescriptor, ToolApprovalPrompt } from '@xqoder/plugin-sdk';
import type { AppEvent } from '@xqoder/protocol';
import type { RuntimeKernel } from '@xqoder/runtime';
import { resolveSessionSummaryById } from '../services/session-resolve.js';
import { toCoreMessage, toProtocolAttachment, type CrashRecoveryCheckpoint } from './agent-service-session-runtime.js';

const PLAN_READ_ONLY_TOOLS = new Set([
    'read_file',
    'grep_content',
    'search_code',
    'glob_files',
    'list_files',
    'fetch_url',
    'websearch',
    'diagnostics',
    'sourcegraph',
    'skill',
    'question',
    'todoread',
]);

export interface LocalMessageCallbacks {
    onEvent: (event: AppEvent) => void;
    onToolApproval?: (request: ToolApprovalPrompt) => Promise<boolean>;
    onQuestion?: (request: QuestionPrompt) => Promise<QuestionAnswer>;
}

export interface LocalRuntimeDescriptorOptions {
    sessionId: string;
    cwd: string;
    prompt: string;
    permissions: PermissionSettings | undefined;
    callbacks: LocalMessageCallbacks;
}

export interface LocalRuntimeRunOptions {
    runtime: RuntimeKernel;
    session: AgentSession;
    prompt: string;
    attachments: SharedMessageAttachment[];
    runtimeDescriptor: RuntimeDescriptor;
    callbacks: Pick<LocalMessageCallbacks, 'onEvent'>;
    persistCrashRecoverySnapshot: () => void;
}

export interface LocalRuntimeFinalizeOptions {
    runtime: RuntimeKernel;
    sessionId: string;
    cwd: string;
    projectRoot: string;
    model: string;
    userMessage: string;
    llmConfig: LLMProviderConfig;
    onTitleGenerated?: (sessionId: string, title: string) => void;
}

export interface LocalAgentSettings {
    dir: string;
    model: string;
    agent: string;
}

export interface PrepareLocalAgentRunOptions {
    sessionId: string | undefined;
    settings: LocalAgentSettings;
    resolveExistingSession: (sessionId: string) => Promise<AgentSession | undefined>;
}

export interface PrepareLocalAgentRunResult {
    resolvedDir: string;
    loadedSession: AgentSession | undefined;
    activeSession: AgentSession;
    agentConfig: AgentConfig;
    permissions: PermissionSettings | undefined;
    crashCheckpoint: CrashRecoveryCheckpoint;
}

export function isPlanReadOnlyTool(toolName: string): boolean {
    return PLAN_READ_ONLY_TOOLS.has(toolName) || toolName.startsWith('lsp_');
}

export function resolveRemoteToolPermissionMode(
    toolName: string,
    permissions: PermissionSettings | undefined,
) {
    return resolveToolPermissionMode(toolName, permissions);
}

export async function prepareLocalAgentRun(
    options: PrepareLocalAgentRunOptions,
): Promise<PrepareLocalAgentRunResult> {
    const resolvedDir = options.settings.dir;
    const loadedConfig = configManager.load({ cwd: resolvedDir });
    const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);

    const loadedSession = options.sessionId
        ? await options.resolveExistingSession(options.sessionId)
        : undefined;

    const baseAgentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
        agentName: options.settings.agent,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        modelOverride: options.settings.model,
        session: loadedSession,
    });

    const activeSession = loadedSession ?? new AgentSession({
        systemPrompt: baseAgentConfig.systemPrompt,
    });

    const agentConfig: AgentConfig = {
        ...baseAgentConfig,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        session: activeSession,
    };

    activeSession.setBaseSystemPrompt(agentConfig.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);

    return {
        resolvedDir,
        loadedSession,
        activeSession,
        agentConfig,
        permissions: effectiveConfig.permissions,
        crashCheckpoint: {
            cwd: resolvedDir,
            projectRoot: resolvedDir,
            model: agentConfig.llmConfig.model,
            title: activeSession.getTitle(),
        },
    };
}

export function logLocalAgentRequest(
    debugLogger: DebugLogger | null | undefined,
    message: string,
    attachments: SharedMessageAttachment[],
): void {
    try {
        debugLogger?.logRequest([{
            role: 'user',
            content: message,
            ...(attachments.length > 0
                ? {
                    attachments: attachments.map((attachment) => ({
                        ...attachment,
                        ...(attachment.data ? { data: `[attachment omitted, ${attachment.data.length} chars]` } : {}),
                    })),
                }
                : {}),
        }]);
    } catch {
        // ignore debug logging failures
    }
}

export function logLocalAgentResponse(
    debugLogger: DebugLogger | null | undefined,
    response: string,
): void {
    try {
        debugLogger?.logResponse({ response });
    } catch {
        // ignore debug logging failures
    }
}

export function createLocalRuntimeDescriptor(options: LocalRuntimeDescriptorOptions): RuntimeDescriptor {
    const isPlanModeRequest = options.prompt.trimStart().startsWith('[Mode: PLAN]');
    return {
        sessionId: options.sessionId,
        cwd: options.cwd,
        permissionPolicy: {
            evaluate: async (request: { target?: string }) => {
                const target = typeof request.target === 'string' ? request.target : '';
                if (isPlanModeRequest && target && !isPlanReadOnlyTool(target)) {
                    return 'deny' as const;
                }
                const mode = resolveRemoteToolPermissionMode(target, options.permissions);
                if (mode === 'ask' && !options.callbacks.onToolApproval) {
                    return 'deny' as const;
                }
                return mode;
            },
        },
        requestToolApproval: options.callbacks.onToolApproval
            ? async (request) => (await options.callbacks.onToolApproval?.(request)) ? 'allow' : 'deny'
            : undefined,
        requestQuestion: options.callbacks.onQuestion
            ? async (request) => (await options.callbacks.onQuestion?.(request)) ?? {
                requestId: request.requestId,
                selected: request.options.length > 0 ? [request.options[0]!.label] : [],
            }
            : async (request) => ({
                requestId: request.requestId,
                selected: request.options.length > 0 ? [request.options[0]!.label] : [],
            }),
    };
}

export async function runLocalRuntimeAgent(options: LocalRuntimeRunOptions): Promise<{ lastAssistantResponse: string }> {
    let lastAssistantResponse = '';
    let lastError: Error | null = null;

    const emit = (event: AppEvent): void => {
        options.callbacks.onEvent(event);
        if (event.type === 'tool.called') {
            try {
                globalEventBus.emit('tool:start', {
                    toolName: event.tool,
                    args: typeof event.args === 'object' && event.args && !Array.isArray(event.args)
                        ? event.args as Record<string, unknown>
                        : {},
                });
            } catch {
                // ignore event bus failures
            }
        }
        if (event.type === 'tool.completed') {
            try {
                globalEventBus.emit('tool:end', { toolName: event.tool, success: event.success });
            } catch {
                // ignore event bus failures
            }
        }
        if (event.type === 'message.completed' && event.message.role === 'assistant') {
            lastAssistantResponse = event.message.content;
        }
        if (event.type === 'error') {
            lastError = new Error(event.message);
        }
        if (
            event.type === 'message.completed'
            && (event.message.role === 'assistant' || event.message.role === 'tool')
        ) {
            options.persistCrashRecoverySnapshot();
        }
    };

    for await (const event of options.runtime.runAgent('xqoder-agent', {
        prompt: options.prompt,
        messages: options.session.getMessages().map((entry, index) => toCoreMessage(entry, options.session.id, index)),
        attachments: options.attachments.map(toProtocolAttachment),
    }, options.runtimeDescriptor)) {
        emit(event);
    }

    if (lastError) {
        throw lastError;
    }

    return { lastAssistantResponse };
}

export async function finalizeLocalRuntimeRun(options: LocalRuntimeFinalizeOptions): Promise<{
    sessionId: string;
    sessionTitle?: string;
}> {
    await options.runtime.updateSession({
        sessionId: options.sessionId,
        cwd: options.cwd,
        metadata: {
            projectRoot: options.projectRoot,
            model: options.model,
        },
    });

    const savedSummary = await resolveSessionSummaryById(options.runtime, options.sessionId);
    if (!savedSummary) {
        throw new Error(`Session summary not found after kernel run: ${options.sessionId}`);
    }

    if (savedSummary.title === savedSummary.lastUserMessage?.slice(0, 50) || !savedSummary.title) {
        const sid = savedSummary.id;
        const userMsg = options.userMessage;
        void (async () => {
            try {
                const titleAgent = new TitleAgent(options.llmConfig);
                const generatedTitle = await titleAgent.generateTitle(userMsg);
                if (generatedTitle) {
                    try {
                        await options.runtime.updateSessionTitle(sid, generatedTitle);
                    } catch {
                        // title persistence is best-effort
                    }
                    options.onTitleGenerated?.(sid, generatedTitle);
                }
            } catch {
                // title generation is best-effort
            }
        })();
    }

    return {
        sessionId: savedSummary.id,
        sessionTitle: savedSummary.title,
    };
}
