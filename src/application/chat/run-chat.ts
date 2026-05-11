import {
    configManager,
    type ConfigManager,
    formatOutput,
    createSpinner,
    type MessageAttachment,
    type OutputFormat,
    type PermissionSettings,
} from '@xqoder/shared';
import {
    XQoderAgent,
    type AgentCallbacks,
} from '@xqoder/agent';
import {
    createConversationEventEnvelopeEmitter,
} from '@xqoder/protocol';
import type {
    AppEvent,
    ConversationEventEnvelope,
    JsonValue,
} from '@xqoder/protocol';
import type { QuestionAnswer, QuestionPrompt } from '@xqoder/plugin-sdk';
import { MISSING_API_KEY_GUIDANCE } from '../config/api-key-guidance.js';
import { llmProviderRequiresApiKey } from '../config/api-key-guidance.js';
import type {
    ChatAgentFactoryConfig,
    ChatAgentInstance,
} from './ports.js';
import { ConversationEngineStopError } from './turn-stop.js';
import { buildLocalFallbackGuidance, type LocalFallbackInput } from '../../shared/local-fallback.js';
import type { ConversationStopReason } from '../../domain/conversation/stop-reason.js';
import {
    buildConversationTurnInput,
    normalizeWorkflowGoal,
    prepareChatExecution,
    type PreparedChatExecution,
    type ChatTurnIntakeDependencies,
    type ConversationTurnEntrypoint,
} from './turn-intake.js';
import {
    resolveDirectChatCommandResponse,
} from './direct-command.js';
import { resolvePromptSubmissionOutcome, writeBlockedPromptResponse } from './turn-intake/submission-preprocess.js';
import {
    createCoreMessage,
    createEnvelopeCallbackBridge,
    emitDirectChatMessageStream,
    getSessionMessageCount,
} from './run-chat-events.js';
import {
    createStreamToolApprovalHandler,
    writeAutoWorkingMemoryNote,
} from './run-chat-stream-helpers.js';
import { removeRepeatedAssistantSections } from './response-cleanup.js';
export {
    buildAutoProjectContext,
    buildChatPromptAppendix,
    buildChatSystemPrompt,
    maybeAugmentPromptWithProjectContext,
    resolveChatRuntimeIdentity,
    shouldUseStructuredEngineeringResponse,
    type ChatRuntimeIdentity,
    type ChatSystemPromptOptions,
} from './prompt-composer.js';

export interface ChatRunOptions {
    dir: string;
    model?: string;
    agent?: string;
    session?: string;
    newSession?: boolean;
    format?: OutputFormat;
    attachments?: MessageAttachment[];
    title?: string;
    maxTurns?: number;
}

export interface ChatServiceDependencies extends ChatTurnIntakeDependencies {
    agentFactory?: (config: ChatAgentFactoryConfig) => ChatAgentInstance;
    localFallbackAdvisor?: (input: LocalFallbackInput) => Promise<string | undefined>;
}

export interface NonInteractivePromptOptions {
    prompt: string;
    cwd: string;
    outputFormat: OutputFormat;
    quiet: boolean;
    model?: string;
    agent?: string;
    resume?: string;
    continue?: boolean;
    forkSession?: boolean;
    permissionMode?: string;
    approvalPolicy?: string;
    effort?: string;
    maxTurns?: number;
    noSessionPersistence?: boolean;
    allowedTools?: string[];
    disallowedTools?: string[];
}

export interface ChatMessageStreamOptions {
    prompt: string;
    cwd: string;
    entrypoint?: ConversationTurnEntrypoint;
    sessionId?: string;
    startNewSession?: boolean;
    shouldPersistSession?: boolean;
    sessionTitle?: string;
    autoApproveTools?: boolean;
    model?: string;
    agent?: string;
    attachments?: MessageAttachment[];
    onEvent: (event: ConversationEventEnvelope) => void;
    requestQuestion?: (prompt: QuestionPrompt) => Promise<QuestionAnswer>;
    requestToolApproval?: AgentCallbacks['onToolApproval'];
    signal?: AbortSignal;
}

/**
 * Chat use cases sit on top of turn intake:
 * - raw entrypoint normalization lives in ./turn-intake.ts
 * - CLI, headless, and HTTP streaming share the same event-oriented turn helper
 */

export async function runChatHeadless(
    prompt: string,
    options: ChatRunOptions,
    dependencies: ChatServiceDependencies = {},
): Promise<{ response: string; sessionId: string }> {
    const outcome = await resolvePromptSubmissionOutcome({
        prompt, cwd: options.dir, sessionId: options.session,
        configManagerOverride: dependencies.configManager,
    });
    if (outcome.status === 'blocked') return { response: outcome.response, sessionId: outcome.sessionId };
    const turnInput = buildConversationTurnInput({
        prompt: outcome.prompt, cwd: options.dir, attachments: options.attachments,
        outputFormat: options.format, model: options.model, agent: options.agent,
        sessionId: options.session, startNewSession: options.newSession ?? false,
        sessionTitle: options.title, requireSessionStore: true, entrypoint: 'headless',
        ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
    });
    const execution = prepareChatExecution(turnInput, dependencies);
    return await runPreparedChatTurn(execution, dependencies, {
        callbacks: {
            onToken: () => {},
        },
    });
}

export async function runChat(
    prompt: string,
    options: ChatRunOptions,
    dependencies: ChatServiceDependencies = {},
    callbacksFactory: () => AgentCallbacks,
): Promise<{ response: string; sessionId: string }> {
    const outcome = await resolvePromptSubmissionOutcome({
        prompt,
        cwd: options.dir,
        sessionId: options.session,
        configManagerOverride: dependencies.configManager,
    });
    if (outcome.status === 'blocked') {
        writeBlockedPromptResponse(outcome.response, options.format ?? 'text');
        return { response: outcome.response, sessionId: outcome.sessionId };
    }
    const turnInput = buildConversationTurnInput({
        prompt: outcome.prompt,
        cwd: options.dir,
        attachments: options.attachments,
        outputFormat: options.format,
        model: options.model,
        agent: options.agent,
        sessionId: options.session,
        startNewSession: options.newSession ?? false,
        sessionTitle: options.title,
        entrypoint: 'cli',
    });
    const execution = prepareChatExecution(turnInput, dependencies);
    const outputFormat = execution.turnInput.outputFormat;
    const isJson = outputFormat === 'json';
    const directResponse = await resolveDirectChatCommandResponse(execution, dependencies);
    const spinner = isJson ? createSpinner('Thinking...') : null;
    try {
        const baseCallbacks = callbacksFactory();
        const callbacks = isJson
            ? { ...baseCallbacks, onToken: () => {} }
            : baseCallbacks;
        const envelopeBridge = createEnvelopeCallbackBridge(callbacks);
        const result = await runPreparedChatTurn(execution, dependencies, {
            callbacks,
            onEvent: envelopeBridge.onEvent,
        });

        spinner?.stop();
        if (isJson) {
            process.stdout.write(formatOutput(result.response, { format: 'json' }));
        } else if (directResponse !== undefined) {
            process.stdout.write(result.response);
        }
        process.stdout.write('\n');
        return result;
    } finally {
        spinner?.stop();
    }
}

export async function runNonInteractivePrompt(
    options: NonInteractivePromptOptions,
    dependencies: ChatServiceDependencies = {},
): Promise<void> {
    const isStreamJson = options.outputFormat === 'stream-json';
    const scopedDependencies = withPromptPermissionOverrides(options, dependencies);
    const spinner = !options.quiet && options.outputFormat === 'text'
        ? createSpinner('Thinking...')
        : null;

    try {
        if (isStreamJson) {
            const result = await runChatMessageStream({
                prompt: options.prompt,
                cwd: options.cwd,
                model: options.model,
                agent: options.agent,
                sessionId: options.resume,
                startNewSession: options.forkSession || (!options.resume && !options.continue),
                shouldPersistSession: !options.noSessionPersistence,
                sessionTitle: buildNonInteractiveTitle(options.prompt),
                autoApproveTools: false,
                entrypoint: 'cli',
                onEvent: (event) => {
                    process.stdout.write(JSON.stringify({ type: 'event', event }) + '\n');
                },
            }, scopedDependencies);
            spinner?.stop();
            process.stdout.write(JSON.stringify({
                type: 'done',
                response: result.response,
                sessionId: result.sessionId,
            }) + '\n');
        } else {
            const turnInput = buildConversationTurnInput({
                prompt: options.prompt,
                cwd: options.cwd,
                outputFormat: options.outputFormat,
                model: options.model,
                agent: options.agent,
                sessionId: options.resume,
                startNewSession: options.forkSession || (!options.resume && !options.continue),
                shouldPersistSession: !options.noSessionPersistence,
                sessionTitle: buildNonInteractiveTitle(options.prompt),
                autoApproveTools: false,
                entrypoint: 'cli',
            });
            const execution = prepareChatExecution(turnInput, scopedDependencies);
            const result = await runPreparedChatTurn(execution, scopedDependencies, {
                callbacks: {
                    onToken: () => {},
                },
            });
            spinner?.stop();
            process.stdout.write(formatOutput(result.response, { format: execution.turnInput.outputFormat }));
            process.stdout.write('\n');
        }
    } finally {
        spinner?.stop();
    }
}

export async function runChatMessageStream(
    options: ChatMessageStreamOptions,
    dependencies: ChatServiceDependencies = {},
): Promise<{ response: string; sessionId: string }> {
    const outcome = await resolvePromptSubmissionOutcome({
        prompt: options.prompt,
        cwd: options.cwd,
        sessionId: options.sessionId,
        configManagerOverride: dependencies.configManager,
    });
    if (outcome.status === 'blocked') return { response: outcome.response, sessionId: outcome.sessionId };
    const turnInput = buildConversationTurnInput({
        prompt: outcome.prompt, cwd: options.cwd, attachments: options.attachments,
        model: options.model, agent: options.agent, sessionId: options.sessionId,
        startNewSession: options.startNewSession ?? false,
        shouldPersistSession: options.shouldPersistSession ?? true,
        requireSessionStore: options.shouldPersistSession ?? true,
        sessionTitle: options.sessionTitle, autoApproveTools: options.autoApproveTools,
        entrypoint: options.entrypoint ?? 'headless',
    });
    const execution = prepareChatExecution(turnInput, dependencies);
    return await runPreparedChatMessageStream(execution, dependencies, {
        onEvent: options.onEvent,
        requestQuestion: options.requestQuestion,
        requestToolApproval: options.requestToolApproval,
        signal: options.signal,
    });
}

async function enrichProviderFailure(
    error: unknown,
    llmConfig: LocalFallbackInput['llmConfig'],
    agentName: string | undefined,
    dependencies: ChatServiceDependencies,
): Promise<Error> {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const advisor = dependencies.localFallbackAdvisor ?? buildLocalFallbackGuidance;
    const guidance = await advisor({ error: normalized, llmConfig, agentName });
    if (!guidance) {
        return normalized;
    }
    return new Error(`${normalized.message}\n\n${guidance}`);
}

function buildNonInteractiveTitle(prompt: string): string {
    const trimmedPrompt = prompt.trim();
    const titleSuffix = trimmedPrompt.length > 100
        ? `${trimmedPrompt.slice(0, 100)}...`
        : trimmedPrompt;

    return `Non-interactive: ${titleSuffix}`;
}

function resolveAgentTextOutput(streamedResponse: string, finalResponse: string): string {
    return removeRepeatedAssistantSections(streamedResponse.length > 0 ? streamedResponse : finalResponse);
}

function resolveTerminalStopReason(
    error: unknown,
    observedStopReason: ConversationStopReason | undefined,
): ConversationStopReason | undefined {
    if (error instanceof ConversationEngineStopError) {
        return error.stopReason;
    }

    return observedStopReason;
}

function persistChatSession(
    execution: PreparedChatExecution,
    agent: ChatAgentInstance,
): string {
    if (!execution.turnInput.shouldPersistSession) {
        return agent.getSession().id;
    }

    const summary = execution.sessionStore?.saveSession({
        session: agent.getSession(),
        projectRoot: execution.turnInput.resolvedDir,
        cwd: execution.turnInput.resolvedDir,
        model: execution.agentConfig.llmConfig.model,
    });
    return summary?.id ?? agent.getSession().id;
}

function recordCompletedWorkflowState(
    execution: PreparedChatExecution,
    session: ReturnType<ChatAgentInstance['getSession']>,
    sourceTurnId?: string,
): void {
    const route = execution.turnInput.runtime.commandRoute;
    if (route.kind !== 'workflow' || route.mode !== 'plan') {
        return;
    }
    if (typeof (session as { recordWorkflowState?: unknown }).recordWorkflowState !== 'function') {
        return;
    }

    session.recordWorkflowState({
        kind: 'plan',
        rawGoal: route.input,
        normalizedGoal: normalizeWorkflowGoal(route.input),
        completedAt: new Date(),
        sourceTurnId: sourceTurnId ?? `${session.id}:turn:${Date.now()}`,
    });
}

function assertProviderReady(
    execution: PreparedChatExecution,
    dependencies: ChatServiceDependencies,
): void {
    if (dependencies.agentFactory) {
        return;
    }

    const { provider, apiKey } = execution.agentConfig.llmConfig;
    if (llmProviderRequiresApiKey(provider) && !apiKey.trim()) {
        throw new Error(MISSING_API_KEY_GUIDANCE);
    }
}

async function runPreparedChatTurn(
    execution: PreparedChatExecution,
    dependencies: ChatServiceDependencies,
    options: {
        callbacks: AgentCallbacks;
        onEvent?: (event: ConversationEventEnvelope) => void;
    },
): Promise<{ response: string; sessionId: string }> {
    return await runPreparedChatMessageStream(execution, dependencies, {
        onEvent: options.onEvent ?? (() => {}),
        requestQuestion: options.callbacks.onQuestion
            ? async (prompt) => await Promise.resolve(options.callbacks.onQuestion?.(prompt) ?? {
                requestId: prompt.requestId,
                selected: prompt.options.length > 0 ? [prompt.options[0]!.label] : [],
            })
            : undefined,
        requestToolApproval: options.callbacks.onToolApproval,
    });
}

async function runPreparedChatMessageStream(
    execution: PreparedChatExecution,
    dependencies: ChatServiceDependencies,
    options: {
        onEvent: (event: ConversationEventEnvelope) => void;
        requestQuestion?: (prompt: QuestionPrompt) => Promise<QuestionAnswer>;
        requestToolApproval?: AgentCallbacks['onToolApproval'];
        signal?: AbortSignal;
    },
): Promise<{ response: string; sessionId: string }> {
    const directResponse = await resolveDirectChatCommandResponse(execution, dependencies);
    if (directResponse !== undefined) {
        return emitDirectChatMessageStream(execution, {
            onEvent: options.onEvent,
        }, directResponse);
    }

    assertProviderReady(execution, dependencies);

    const agent = createChatAgent(execution, dependencies);
    if (agent.streamTurn) {
        return await consumeCanonicalAgentStream(
            execution,
            dependencies,
            agent as ChatAgentInstance & {
                streamTurn: NonNullable<ChatAgentInstance['streamTurn']>;
                cancel?: () => void;
                abort?: () => Promise<void>;
            },
            options,
        );
    }

    const session = agent.getSession();
    const sessionId = session.id;
    const provider = execution.turnInput.agent ?? 'xqoder-agent';
    const assistantMessageId = `${sessionId}:assistant:${Date.now()}`;
    const userMessageId = `${sessionId}:user:${Date.now()}`;
    const createdAt = Date.now();
    const eventEmitter = createConversationEventEnvelopeEmitter(sessionId);
    const userMessage = createCoreMessage({
        id: userMessageId,
        sessionId,
        role: 'user',
        content: execution.turnInput.preparedPrompt,
        createdAt,
        attachments: execution.turnInput.attachments,
    });
    let assistantStarted = false;
    let assistantText = '';
    let emittedError = false;
    let terminalStopReason: ConversationStopReason | undefined;

    const emitEvent = (event: AppEvent): void => {
        const envelope = eventEmitter.emit(event);
        session.recordConversationEnvelopeEvent?.(envelope);
        options.onEvent(envelope);
    };
    const emitErrorEvent = (message: string, stopReason?: ConversationStopReason): void => {
        if (emittedError) {
            return;
        }
        emittedError = true;
        emitEvent({
            type: 'error',
            sessionId,
            timestamp: Date.now(),
            source: 'agent',
            message,
            recoverable: false,
            ...(stopReason !== undefined ? { stopReason } : {}),
        });
    };
    const ensureAssistantStarted = (): void => {
        if (assistantStarted) {
            return;
        }
        assistantStarted = true;
        emitEvent({
            type: 'message.started',
            sessionId,
            timestamp: Date.now(),
            source: 'agent',
            message: {
                id: assistantMessageId,
                sessionId,
                role: 'assistant',
                content: '',
                createdAt: Date.now(),
            },
        });
    };

    emitEvent(
        execution.agentConfig.session
            ? {
                type: 'session.resumed',
                sessionId,
                timestamp: Date.now(),
                source: 'agent',
                messageCount: getSessionMessageCount(execution.agentConfig.session),
            }
            : {
                type: 'session.started',
                sessionId,
                timestamp: Date.now(),
                source: 'agent',
                cwd: execution.turnInput.resolvedDir,
            },
    );
    emitEvent({
        type: 'message.started',
        sessionId,
        timestamp: Date.now(),
        source: 'agent',
        message: userMessage,
    });
    emitEvent({
        type: 'message.completed',
        sessionId,
        timestamp: Date.now(),
        source: 'agent',
        message: userMessage,
    });
    emitEvent({
        type: 'status.changed',
        sessionId,
        timestamp: Date.now(),
        source: 'agent',
        status: 'thinking',
    });

    const abortableAgent = agent as ChatAgentInstance & {
        cancel?: () => void;
        abort?: () => Promise<void>;
    };
    const abortListener = () => {
        abortableAgent.cancel?.();
        void abortableAgent.abort?.();
    };
    options.signal?.addEventListener('abort', abortListener, { once: true });

    const requestToolApproval = createStreamToolApprovalHandler({
        emitEvent,
        requestToolApproval: options.requestToolApproval,
        sessionId,
    });

    try {
        const finalResponse = await agent.run(execution.turnInput.preparedPrompt, {
            onIteration: () => {
                emitEvent({
                    type: 'status.changed',
                    sessionId,
                    timestamp: Date.now(),
                    source: 'agent',
                    status: 'thinking',
                });
            },
            onToken: (token) => {
                ensureAssistantStarted();
                assistantText += token;
                emitEvent({
                    type: 'message.delta',
                    sessionId,
                    timestamp: Date.now(),
                    source: 'agent',
                    messageId: assistantMessageId,
                    role: 'assistant',
                    text: token,
                });
            },
            onThinkingToken: (token) => {
                emitEvent({
                    type: 'thought',
                    sessionId,
                    timestamp: Date.now(),
                    source: 'agent',
                    text: token,
                });
            },
            onToolStart: (name, args) => {
                emitEvent({
                    type: 'tool.called',
                    sessionId,
                    timestamp: Date.now(),
                    source: 'agent',
                    provider,
                    tool: name,
                    args: args as JsonValue,
                });
                emitEvent({
                    type: 'status.changed',
                    sessionId,
                    timestamp: Date.now(),
                    source: 'agent',
                    status: 'running-tool',
                });
            },
            onToolStream: (name, chunk) => {
                emitEvent({
                    type: 'tool.output',
                    sessionId,
                    timestamp: Date.now(),
                    source: 'agent',
                    provider,
                    tool: name,
                    output: chunk,
                    partial: true,
                });
            },
            onToolEnd: (name, result, success) => {
                emitEvent({
                    type: 'tool.output',
                    sessionId,
                    timestamp: Date.now(),
                    source: 'agent',
                    provider,
                    tool: name,
                    output: result,
                });
                emitEvent({
                    type: 'tool.completed',
                    sessionId,
                    timestamp: Date.now(),
                    source: 'agent',
                    provider,
                    tool: name,
                    success,
                });
                emitEvent({
                    type: 'status.changed',
                    sessionId,
                    timestamp: Date.now(),
                    source: 'agent',
                    status: 'thinking',
                });
            },
            onToolApproval: requestToolApproval,
            onQuestion: async (prompt) => {
                emitEvent({
                    type: 'question.requested',
                    sessionId,
                    timestamp: Date.now(),
                    source: 'agent',
                    requestId: prompt.requestId,
                    question: prompt.question,
                    ...(prompt.header ? { header: prompt.header } : {}),
                    options: prompt.options,
                    ...(prompt.multiple ? { multiple: true } : {}),
                    ...(prompt.allowCustom ? { allowCustom: true } : {}),
                });

                const answer = options.requestQuestion
                    ? await options.requestQuestion(prompt)
                    : {
                        requestId: prompt.requestId,
                        selected: prompt.options.length > 0 ? [prompt.options[0]!.label] : [],
                    };

                emitEvent({
                    type: 'question.resolved',
                    sessionId,
                    timestamp: Date.now(),
                    source: 'agent',
                    requestId: prompt.requestId,
                    selected: answer.selected ?? [],
                    ...(answer.customText ? { customText: answer.customText } : {}),
                    answerSource: options.requestQuestion ? 'ui' : 'fallback',
                });
                return answer;
            },
            onError: (error) => {
                emitErrorEvent(error.message, terminalStopReason);
            },
            onStop: (stopReason) => {
                terminalStopReason = stopReason;
            },
            onEvent: (event: Parameters<NonNullable<AgentCallbacks['onEvent']>>[0]) => {
                if (event.type === 'usage') {
                    emitEvent({
                        type: 'usage',
                        sessionId,
                        timestamp: Date.now(),
                        source: 'agent',
                        model: event.model,
                        promptTokens: event.promptTokens,
                        completionTokens: event.completionTokens,
                        totalTokens: event.totalTokens,
                        ...(event.cost !== undefined ? { cost: event.cost } : {}),
                    });
                    return;
                }
                if (event.type === 'verification') {
                    emitEvent({
                        type: 'verification.completed',
                        sessionId,
                        timestamp: Date.now(),
                        source: 'agent',
                        ok: event.ok,
                        blocked: event.blocked,
                        summary: event.summary,
                    });
                    return;
                }
                if (event.type === 'error') {
                    emitErrorEvent(event.message, terminalStopReason);
                }
            },
        }, execution.turnInput.attachments);

        ensureAssistantStarted();
        const resolvedResponse = resolveAgentTextOutput(assistantText, finalResponse);
        const assistantMessage = createCoreMessage({
            id: assistantMessageId,
            sessionId,
            role: 'assistant',
            content: resolvedResponse,
            createdAt: Date.now(),
        });
        emitEvent({
            type: 'message.completed',
            sessionId,
            timestamp: Date.now(),
            source: 'agent',
            message: assistantMessage,
        });
        emitEvent({
            type: 'status.changed',
            sessionId,
            timestamp: Date.now(),
            source: 'agent',
            status: 'done',
            stopReason: terminalStopReason ?? 'completed',
        });

        recordCompletedWorkflowState(execution, agent.getSession());
        const persistedSessionId = persistChatSession(execution, agent);
        writeAutoWorkingMemoryNote(execution, resolvedResponse);
        return {
            response: resolvedResponse,
            sessionId: persistedSessionId,
        };
    } catch (error) {
        const stopReason = resolveTerminalStopReason(error, terminalStopReason);
        const enriched = await enrichProviderFailure(
            error,
            execution.agentConfig.llmConfig,
            execution.turnInput.agent,
            dependencies,
        );
        emitErrorEvent(enriched.message, stopReason);
        emitEvent({
            type: 'status.changed',
            sessionId,
            timestamp: Date.now(),
            source: 'agent',
            status: 'error',
            ...(stopReason !== undefined ? { stopReason } : {}),
            message: enriched.message,
        });
        throw enriched;
    } finally {
        options.signal?.removeEventListener('abort', abortListener);
        await agent.dispose?.();
    }
}

function createChatAgent(
    execution: PreparedChatExecution,
    dependencies: ChatServiceDependencies,
): ChatAgentInstance {
    const factoryConfig: ChatAgentFactoryConfig = {
        ...execution.agentConfig,
        cwd: execution.turnInput.resolvedDir,
        projectRoot: execution.turnInput.resolvedDir,
        systemPrompt: execution.agentConfig.systemPrompt ?? '',
        sandboxMode: execution.agentConfig.sandboxMode ?? execution.sandbox.mode,
        allowedPaths: execution.agentConfig.allowedPaths ?? execution.sandbox.allowedPaths,
    };

    return dependencies.agentFactory?.(factoryConfig) ?? new XQoderAgent(execution.agentConfig);
}

async function consumeCanonicalAgentStream(
    execution: PreparedChatExecution,
    dependencies: ChatServiceDependencies,
    agent: ChatAgentInstance & {
        streamTurn: NonNullable<ChatAgentInstance['streamTurn']>;
        cancel?: () => void;
        abort?: () => Promise<void>;
    },
    options: {
        onEvent: (event: ConversationEventEnvelope) => void;
        requestQuestion?: (prompt: QuestionPrompt) => Promise<QuestionAnswer>;
        requestToolApproval?: AgentCallbacks['onToolApproval'];
        signal?: AbortSignal;
    },
): Promise<{ response: string; sessionId: string }> {
    const session = agent.getSession();
    const abortableAgent = agent as ChatAgentInstance & {
        cancel?: () => void;
        abort?: () => Promise<void>;
    };
    const abortListener = () => {
        abortableAgent.cancel?.();
        void abortableAgent.abort?.();
    };
    options.signal?.addEventListener('abort', abortListener, { once: true });

    let assistantResponse = '';
    let lastTurnId: string | undefined;
    let terminalStopReason: ConversationStopReason | undefined;
    let terminalMessage: string | undefined;
    let terminalEventSeen = false;
    let errorEventSeen = false;

    try {
        for await (const event of agent.streamTurn(
            execution.turnInput.preparedPrompt,
            {
                onToolApproval: options.requestToolApproval,
                onQuestion: options.requestQuestion,
            },
            execution.turnInput.attachments,
        )) {
            session.recordConversationEnvelopeEvent?.(event);
            options.onEvent(event);
            lastTurnId = event.turnId;

            if (event.type === 'message.completed' && event.payload.message.role === 'assistant') {
                assistantResponse = event.payload.message.content;
            }

            if (event.type === 'error') {
                errorEventSeen = true;
                terminalStopReason = event.payload.stopReason ?? terminalStopReason;
                terminalMessage = event.payload.message;
            }

            if (event.type === 'status.changed' && (event.payload.status === 'done' || event.payload.status === 'error')) {
                terminalEventSeen = true;
                terminalStopReason = event.payload.stopReason ?? terminalStopReason;
                terminalMessage = event.payload.message ?? terminalMessage;
            }
        }

        if (terminalStopReason === 'permission_denied' || terminalStopReason === 'provider_error') {
            throw new Error(terminalMessage ?? 'Agent turn failed');
        }

        recordCompletedWorkflowState(execution, agent.getSession(), lastTurnId);
        const persistedSessionId = persistChatSession(execution, agent);
        writeAutoWorkingMemoryNote(execution, assistantResponse);
        return {
            response: assistantResponse,
            sessionId: persistedSessionId,
        };
    } catch (error) {
        const stopReason = resolveTerminalStopReason(error, terminalStopReason);
        const enriched = await enrichProviderFailure(
            error,
            execution.agentConfig.llmConfig,
            execution.turnInput.agent,
            dependencies,
        );

        if (!terminalEventSeen && !errorEventSeen) {
            options.onEvent(createConversationEventEnvelopeEmitter(session.id).emitRecord('error', {
                source: 'agent',
                message: enriched.message,
                recoverable: false,
                ...(stopReason !== undefined ? { stopReason } : {}),
            }));
            options.onEvent(createConversationEventEnvelopeEmitter(session.id).emitRecord('status.changed', {
                source: 'agent',
                status: 'error',
                stopReason: stopReason ?? 'provider_error',
                message: enriched.message,
            }));
        }

        throw enriched;
    } finally {
        options.signal?.removeEventListener('abort', abortListener);
        await agent.dispose?.();
    }
}

function withPromptPermissionOverrides(
    options: NonInteractivePromptOptions,
    dependencies: ChatServiceDependencies,
): ChatServiceDependencies {
    const permissionOverrides = buildPromptPermissionOverrides(options);
    if (!permissionOverrides) {
        return dependencies;
    }

    const baseManager = dependencies.configManager ?? configManager;
    const mergedManager = {
        load: (...args: Parameters<Pick<ConfigManager, 'load'>['load']>) => {
            const loaded = baseManager.load(...args);
            return {
                ...loaded,
                permissions: mergePermissionOverrides(loaded.permissions, permissionOverrides),
            };
        },
        ...(
            typeof (baseManager as { getLoadMetadata?: unknown }).getLoadMetadata === 'function'
                ? {
                    getLoadMetadata: () => (baseManager as unknown as Pick<ConfigManager, 'getLoadMetadata'>).getLoadMetadata(),
                }
                : {}
        ),
    };

    return {
        ...dependencies,
        configManager: mergedManager,
    };
}

function buildPromptPermissionOverrides(
    options: NonInteractivePromptOptions,
): PermissionSettings | undefined {
    const approvalPolicy = resolvePromptApprovalPolicy(options.permissionMode, options.approvalPolicy);
    const allowedTools = normalizeToolNameList(options.allowedTools);
    const disallowedTools = normalizeToolNameList(options.disallowedTools);

    if (!approvalPolicy && allowedTools.length === 0 && disallowedTools.length === 0) {
        return undefined;
    }

    return {
        ...(approvalPolicy ? { approvalPolicy } : {}),
        ...(allowedTools.length > 0 ? { allowedTools } : {}),
        ...(disallowedTools.length > 0 ? { disallowedTools } : {}),
    };
}

function resolvePromptApprovalPolicy(
    permissionMode: string | undefined,
    approvalPolicy: string | undefined,
): Extract<PermissionSettings['approvalPolicy'], 'strict' | 'balanced' | 'workspace_auto'> | undefined {
    const normalizedPolicy = approvalPolicy?.trim().toLowerCase();
    if (normalizedPolicy === 'strict' || normalizedPolicy === 'balanced' || normalizedPolicy === 'workspace_auto') {
        return normalizedPolicy;
    }

    const normalizedMode = permissionMode?.trim().toLowerCase();
    if (normalizedMode === 'allow' || normalizedMode === 'auto') {
        return 'workspace_auto';
    }
    if (normalizedMode === 'ask' || normalizedMode === 'deny') {
        return 'strict';
    }

    return undefined;
}

function mergePermissionOverrides(
    base: PermissionSettings | undefined,
    override: PermissionSettings,
): PermissionSettings {
    return {
        ...(base ?? {}),
        ...override,
        tools: {
            ...(base?.tools ?? {}),
            ...(override.tools ?? {}),
        },
        ...(override.allowedTools
            ? { allowedTools: [...override.allowedTools] }
            : base?.allowedTools
                ? { allowedTools: [...base.allowedTools] }
                : {}),
        ...(override.disallowedTools
            ? { disallowedTools: [...override.disallowedTools] }
            : base?.disallowedTools
                ? { disallowedTools: [...base.disallowedTools] }
                : {}),
    };
}

function normalizeToolNameList(values: string[] | undefined): string[] {
    return (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean);
}
