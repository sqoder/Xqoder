import type {
    CompactionConfig,
    LLMProviderConfig,
    Logger,
    MessageAttachment,
    TaskMode,
    ToolCall,
    ToolDefinition,
    ToolResult,
} from '@xqoder/shared';
import { getContextWindow } from '@xqoder/shared';
import {
    createConversationEventEnvelopeEmitter,
    type ConversationEventEnvelope,
    type ConversationEventPayloadMap,
    type JsonValue,
} from '@xqoder/protocol';
import type {
    AgentEvents,
    AgentCallbacks,
    AgentRuntimeProfile,
    AgentSession,
    ToolApprovalRequest,
} from '@xqoder/agent';
import type {
    CompletionRequest,
    ILLMProvider,
} from '@xqoder/llm-api';
import {
    handleToolFollowUp,
    type ToolFollowUpResult,
} from './tool-follow-up.js';
import {
    runProviderTurn,
    type ProviderTurnResult,
} from './provider-turn.js';
import {
    ConversationEngineResult,
    ConversationEngineStopError,
    ConversationStopReason,
} from './turn-stop.js';
import {
    compactIntermediateResponse,
    removeRepeatedAssistantSections,
} from './response-cleanup.js';
import type { VerificationGateResult } from './verification-gate.js';
import type { ConversationTurnInput } from './turn-intake.js';
import type { ToolExecutionPort } from '../../domain/conversation/tool-execution-port.js';
export {
    ConversationEngineStopError,
    type ConversationEngineResult,
    type ConversationStopReason,
} from './turn-stop.js';

export interface ConversationEngineCallbacks extends AgentCallbacks {}

export interface ConversationEngine {
    runTurn(input: ConversationTurnInput): AsyncIterable<ConversationEventEnvelope>;
}

export interface ConversationForcedStopDirective {
    stopReason: Extract<ConversationStopReason, 'max_turns' | 'max_wall_time'>;
    message: string;
}

export interface ConversationRuntimeLike {
    prepareMessages(): CompletionRequest['messages'];
    runPostToolVerification(): Promise<void>;
    getForcedStopDirective?(): ConversationForcedStopDirective | undefined;
    getForcedStopMessage?(): string | undefined;
    getCompletionBlocker(): string | undefined;
    getNoToolCompletionBlocker(toolUsed: boolean): string | undefined;
    shouldDeferAssistantOutput?(toolUsed: boolean): boolean;
    finalizeAssistantResponse(content: string): string;
}

type ConversationEventEmitter = <K extends keyof AgentEvents>(
    type: K,
    data: AgentEvents[K],
    streamId?: string,
) => void;

export interface ConversationEngineDependencies {
    provider: ILLMProvider;
    session: AgentSession;
    userMessage: string;
    attachments?: MessageAttachment[];
    callbacks?: ConversationEngineCallbacks;
    streamId: string;
    abortSignal: AbortSignal;
    logger: Logger;
    llmConfig: LLMProviderConfig;
    agentName?: string;
    runtimeProfile: AgentRuntimeProfile;
    maxTurns?: number;
    // Legacy caller alias; the engine protocol reports max_turns.
    maxIterations?: number;
    maxToolCalls?: number;
    maxWallTimeMs?: number;
    compaction?: CompactionConfig;
    cwd?: string;
    sessionResumed?: boolean;
    emit: ConversationEventEmitter;
    getToolDefinitions: () => ToolDefinition[];
    taskMode?: TaskMode;
    toolExecutionPort?: ToolExecutionPort<ConversationEngineCallbacks>;
    executeToolCalls: (
        toolCalls: ToolCall[],
        callbacks: ConversationEngineCallbacks | undefined,
        streamId: string,
    ) => Promise<ToolResult[]>;
    syncMcpTools?: () => Promise<void>;
    createRuntime?: () => ConversationRuntimeLike | undefined;
    now?: () => number;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
    private readonly values: T[] = [];
    private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
    private closed = false;

    push(value: T): void {
        if (this.closed) {
            return;
        }

        const waiter = this.waiters.shift();
        if (waiter) {
            waiter({ value, done: false });
            return;
        }

        this.values.push(value);
    }

    close(): void {
        this.closed = true;
        while (this.waiters.length > 0) {
            this.waiters.shift()?.({ value: undefined, done: true });
        }
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
            next: () => {
                const value = this.values.shift();
                if (value !== undefined) {
                    return Promise.resolve({ value, done: false });
                }

                if (this.closed) {
                    return Promise.resolve({ value: undefined, done: true });
                }

                return new Promise<IteratorResult<T>>((resolve) => {
                    this.waiters.push(resolve);
                });
            },
        };
    }
}

/**
 * Application-layer turn loop:
 * - is the execution path behind XQoderAgent.run() compatibility calls
 * - provider raw stream details stay behind the provider-turn adapter seam
 * - tool execution and verifier follow-up stay behind dedicated application seams
 */
async function executeConversationTurn(
    dependencies: ConversationEngineDependencies,
): Promise<ConversationEngineResult> {
    dependencies.session.addUserMessage(
        dependencies.userMessage,
        dependencies.attachments ?? [],
    );
    const toolHistoryBaseline = dependencies.session.getToolHistory().length;
    dependencies.logger.info(`User request: ${dependencies.userMessage.slice(0, 100)}...`);
    const runtime = dependencies.createRuntime?.();
    const now = dependencies.now ?? Date.now;
    const startedAt = now();
    const maxTurns = resolveMaxTurns(dependencies);

    let iteration = 0;
    let toolCallCount = 0;
    let lastToolCallBatchFingerprint: string | undefined;
    let lastBlockedContinuationFingerprint: string | undefined;
    let activeVerificationBlocker: string | undefined;

    while (iteration < maxTurns) {
        if (dependencies.abortSignal.aborted) {
            dependencies.logger.warn('Agent cancelled by user');
            emitAgentEnd(dependencies, 'aborted', 'user_cancelled');
            return {
                response: '[cancelled by user]',
                stopReason: 'user_cancelled',
                iterations: iteration,
                toolCallCount,
            };
        }

        if (isWallTimeExceeded(startedAt, now(), dependencies.maxWallTimeMs)) {
            throw createStopError(
                `Maximum wall time reached (${dependencies.maxWallTimeMs}ms)`,
                {
                    stopReason: 'max_wall_time',
                    agentEndReason: 'failed',
                },
                dependencies,
            );
        }

        iteration += 1;
        try { dependencies.callbacks?.onIteration?.(iteration); } catch { /* noop */ }
        dependencies.logger.debug(`Iteration ${iteration}/${maxTurns}`);

        if (dependencies.runtimeProfile !== 'mvp') {
            try { await dependencies.syncMcpTools?.(); } catch { /* MCP sync failure is non-fatal */ }
        }

        const forcedStopDirective = resolveForcedStopDirective(runtime);
        if (forcedStopDirective) {
            dependencies.logger.warn(`MVP runtime forced stop: ${forcedStopDirective.message}`);
            emitAgentEnd(dependencies, 'completed', forcedStopDirective.stopReason);
            return {
                response: forcedStopDirective.message,
                stopReason: forcedStopDirective.stopReason,
                iterations: iteration,
                toolCallCount,
            };
        }

        const toolUsedBeforeProviderTurn = dependencies.session.getToolHistory().length > toolHistoryBaseline;
        const response = await requestAssistantTurn(dependencies, runtime, toolUsedBeforeProviderTurn);
        await maybeAutoCompact(response.usage, dependencies);

        const completionBlocker = response.finishReason === 'tool_calls'
            ? undefined
            : activeVerificationBlocker ?? runtime?.getCompletionBlocker();

        if (response.finishReason === 'tool_calls' && response.message.toolCalls) {
            dependencies.session.addAssistantMessage({
                ...response.message,
                content: compactIntermediateResponse(response.message.content),
            });
            const toolCallBatchFingerprint = createToolCallBatchFingerprint(response.message.toolCalls);
            if (toolCallBatchFingerprint === lastToolCallBatchFingerprint) {
                throw createStopError(
                    `Duplicate tool call batch detected: ${describeToolCallBatch(response.message.toolCalls)}`,
                    {
                        stopReason: 'duplicate_tool_call',
                        agentEndReason: 'failed',
                    },
                    dependencies,
                );
            }

            lastToolCallBatchFingerprint = toolCallBatchFingerprint;
            lastBlockedContinuationFingerprint = undefined;
            const nextToolCallCount = toolCallCount + response.message.toolCalls.length;
            if (dependencies.maxToolCalls !== undefined && nextToolCallCount > dependencies.maxToolCalls) {
                throw createStopError(
                    `Maximum tool calls reached (${dependencies.maxToolCalls})`,
                    {
                        stopReason: 'max_tool_calls',
                        agentEndReason: 'failed',
                    },
                    dependencies,
                );
            }
            toolCallCount = nextToolCallCount;
            const followUp = await handleToolFollowUp({
                toolCalls: response.message.toolCalls,
                callbacks: dependencies.callbacks,
                streamId: dependencies.streamId,
                session: dependencies.session,
                runtime,
                taskMode: dependencies.taskMode,
                toolExecutionPort: dependencies.toolExecutionPort,
                executeToolCalls: dependencies.executeToolCalls,
            });
            activeVerificationBlocker = followUp.verification.completionBlocker;
            const permissionDeniedMessage = recordToolFollowUpResult(followUp, dependencies);
            if (permissionDeniedMessage) {
                throw createStopError(
                    permissionDeniedMessage,
                    {
                        stopReason: 'permission_denied',
                        agentEndReason: 'failed',
                    },
                    dependencies,
                );
            }
            continue;
        }

        const toolUsedInCurrentRun = dependencies.session.getToolHistory().length > toolHistoryBaseline;
        const noToolCompletionBlocker = completionBlocker
            ? undefined
            : runtime?.getNoToolCompletionBlocker(toolUsedInCurrentRun);

        if (completionBlocker) {
            assertProgressOnBlockedContinuation({
                blocker: completionBlocker,
                assistantContent: response.message.content,
                dependencies,
                lastFingerprint: lastBlockedContinuationFingerprint,
                stopReason: activeVerificationBlocker
                    ? 'verification_failed'
                    : 'no_progress',
            });
            lastBlockedContinuationFingerprint = createBlockedContinuationFingerprint(
                completionBlocker,
                response.message.content,
            );
            dependencies.session.addMessage({
                role: 'system',
                content: completionBlocker,
            });
            continue;
        }

        if (noToolCompletionBlocker) {
            assertProgressOnBlockedContinuation({
                blocker: noToolCompletionBlocker,
                assistantContent: response.message.content,
                dependencies,
                lastFingerprint: lastBlockedContinuationFingerprint,
                stopReason: 'no_progress',
            });
            lastBlockedContinuationFingerprint = createBlockedContinuationFingerprint(
                noToolCompletionBlocker,
                response.message.content,
            );
            dependencies.session.addMessage({
                role: 'system',
                content: noToolCompletionBlocker,
            });

            const recoveryToolCall = createReadOnlyRecoveryToolCall({
                blocker: noToolCompletionBlocker,
                dependencies,
                iteration,
            });
            if (recoveryToolCall) {
                const toolCallBatchFingerprint = createToolCallBatchFingerprint([recoveryToolCall]);
                if (toolCallBatchFingerprint === lastToolCallBatchFingerprint) {
                    throw createStopError(
                        `Duplicate tool call batch detected: ${describeToolCallBatch([recoveryToolCall])}`,
                        {
                            stopReason: 'duplicate_tool_call',
                            agentEndReason: 'failed',
                        },
                        dependencies,
                    );
                }

                const nextToolCallCount = toolCallCount + 1;
                if (dependencies.maxToolCalls !== undefined && nextToolCallCount > dependencies.maxToolCalls) {
                    throw createStopError(
                        `Maximum tool calls reached (${dependencies.maxToolCalls})`,
                        {
                            stopReason: 'max_tool_calls',
                            agentEndReason: 'failed',
                        },
                        dependencies,
                    );
                }

                lastToolCallBatchFingerprint = toolCallBatchFingerprint;
                lastBlockedContinuationFingerprint = undefined;
                toolCallCount = nextToolCallCount;
                const followUp = await handleToolFollowUp({
                    toolCalls: [recoveryToolCall],
                    callbacks: dependencies.callbacks,
                    streamId: dependencies.streamId,
                    session: dependencies.session,
                    runtime,
                    taskMode: dependencies.taskMode,
                    toolExecutionPort: dependencies.toolExecutionPort,
                    executeToolCalls: dependencies.executeToolCalls,
                });
                activeVerificationBlocker = followUp.verification.completionBlocker;
                const permissionDeniedMessage = recordToolFollowUpResult(followUp, dependencies);
                if (permissionDeniedMessage) {
                    throw createStopError(
                        permissionDeniedMessage,
                        {
                            stopReason: 'permission_denied',
                            agentEndReason: 'failed',
                        },
                        dependencies,
                    );
                }
            }
            continue;
        }

        const finalContent = removeRepeatedAssistantSections(
            runtime?.finalizeAssistantResponse(response.message.content) ?? response.message.content,
        );
        dependencies.session.addAssistantMessage({
            ...response.message,
            content: finalContent,
        });
        dependencies.logger.success(`Agent completed in ${iteration} iterations`);
        emitAgentEnd(dependencies, 'completed', 'completed');
        return {
            response: finalContent,
            stopReason: 'completed',
            iterations: iteration,
            toolCallCount,
        };
    }

    throw createStopError(
        `Maximum turns reached (${maxTurns})`,
        {
            stopReason: 'max_turns',
            agentEndReason: 'failed',
        },
        dependencies,
    );
}

export function streamConversationTurn(
    dependencies: ConversationEngineDependencies,
): AsyncIterable<ConversationEventEnvelope> {
    const stream = createConversationTurnStream(dependencies);
    // Stream-only callers consume terminal status/error envelopes rather than awaiting the
    // internal completion promise, so sink rejections here to avoid unhandled promise noise.
    void stream.completed.catch((): void => undefined);
    return stream.events;
}

export async function runConversationTurn(
    dependencies: ConversationEngineDependencies,
): Promise<ConversationEngineResult> {
    const stream = createConversationTurnStream(dependencies);
    try {
        for await (const _event of stream.events) {
            // Drain the canonical stream; legacy callers consume the summarized result below.
        }
        return await stream.completed;
    } catch (error) {
        await stream.completed.catch((): void => undefined);
        throw error;
    }
}

export async function runConversationEngine(
    dependencies: ConversationEngineDependencies,
): Promise<string> {
    const result = await runConversationTurn(dependencies);
    return result.response;
}

function createConversationTurnStream(
    dependencies: ConversationEngineDependencies,
): {
    events: AsyncIterable<ConversationEventEnvelope>;
    completed: Promise<ConversationEngineResult>;
} {
    const sessionId = dependencies.session.id;
    const initialMessageCount = dependencies.session.getMessages().length;
    const eventQueue = new AsyncEventQueue<ConversationEventEnvelope>();
    const eventEmitter = createConversationEventEnvelopeEmitter(sessionId);
    const userMessageId = `${sessionId}:user:${Date.now()}`;
    const assistantMessageId = `${sessionId}:assistant:${Date.now()}`;
    const userMessageCreatedAt = Date.now();

    let assistantStarted = false;
    let assistantText = '';

    const pushEnvelope = (event: ConversationEventEnvelope): void => {
        dependencies.session.recordConversationEnvelopeEvent(event);
        eventQueue.push(event);
    };
    const emitRecord = <TType extends keyof ConversationEventPayloadMap>(
        type: TType,
        payload: ConversationEventPayloadMap[TType],
    ): ConversationEventEnvelope<TType> => {
        const event = eventEmitter.emitRecord(type, payload);
        pushEnvelope(event);
        return event;
    };
    const ensureAssistantStarted = (): void => {
        if (assistantStarted) {
            return;
        }

        assistantStarted = true;
        emitRecord('message.started', {
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

    const completed = (async () => {
        emitRecord(
            dependencies.sessionResumed === true || initialMessageCount > 1
                ? 'session.resumed'
                : 'session.started',
            dependencies.sessionResumed === true || initialMessageCount > 1
                ? {
                    source: 'agent',
                    messageCount: initialMessageCount,
                }
                : {
                    source: 'agent',
                    cwd: dependencies.cwd ?? process.cwd(),
                },
        );
        emitRecord('message.started', {
            source: 'agent',
            message: {
                id: userMessageId,
                sessionId,
                role: 'user',
                content: dependencies.userMessage,
                createdAt: userMessageCreatedAt,
                ...(dependencies.attachments && dependencies.attachments.length > 0
                    ? {
                        attachments: dependencies.attachments.map((attachment) => ({
                            kind: attachment.type,
                            mimeType: attachment.mimeType,
                            data: attachment.data,
                            fileName: attachment.fileName,
                            filePath: attachment.filePath,
                        })),
                    }
                    : {}),
            },
        });
        emitRecord('message.completed', {
            source: 'agent',
            message: {
                id: userMessageId,
                sessionId,
                role: 'user',
                content: dependencies.userMessage,
                createdAt: userMessageCreatedAt,
                ...(dependencies.attachments && dependencies.attachments.length > 0
                    ? {
                        attachments: dependencies.attachments.map((attachment) => ({
                            kind: attachment.type,
                            mimeType: attachment.mimeType,
                            data: attachment.data,
                            fileName: attachment.fileName,
                            filePath: attachment.filePath,
                        })),
                    }
                    : {}),
            },
        });
        emitRecord('status.changed', {
            source: 'agent',
            status: 'thinking',
        });

        const callbacks: ConversationEngineCallbacks = {
            onIteration: (count) => {
                try { dependencies.callbacks?.onIteration?.(count); } catch { /* noop */ }
                emitRecord('status.changed', {
                    source: 'agent',
                    status: 'thinking',
                });
            },
            onToken: (token) => {
                try { dependencies.callbacks?.onToken?.(token); } catch { /* noop */ }
                ensureAssistantStarted();
                assistantText += token;

                // Real-time repetition detection:
                if (assistantText.length > 2000) {
                    const tail = assistantText.slice(-300);
                    const head = assistantText.slice(0, 1200);
                    if (head.includes(tail)) {
                        dependencies.logger.warn('Repetition loop detected in LLM stream, aborting turn early for auto-cleanup.');
                        throw new ConversationEngineStopError('Repetition loop detected; response auto-truncated.', {
                            stopReason: 'no_progress',
                            agentEndReason: 'failed',
                        });
                    }
                }

                emitRecord('message.delta', {
                    source: 'agent',
                    messageId: assistantMessageId,
                    role: 'assistant',
                    text: token,
                });
            },
            onThinkingToken: (token) => {
                try { dependencies.callbacks?.onThinkingToken?.(token); } catch { /* noop */ }
                emitRecord('thought', {
                    source: 'agent',
                    text: token,
                });
            },
            onToolCall: (toolCall) => {
                try { dependencies.callbacks?.onToolCall?.(toolCall); } catch { /* noop */ }
            },
            onToolStart: (name, args) => {
                try { dependencies.callbacks?.onToolStart?.(name, args); } catch { /* noop */ }
                emitRecord('tool.called', {
                    source: 'agent',
                    provider: dependencies.agentName ?? 'xqoder-agent',
                    tool: name,
                    args: args as JsonValue,
                });
                emitRecord('status.changed', {
                    source: 'agent',
                    status: 'running-tool',
                });
            },
            onToolStream: (name, chunk, stream) => {
                try { dependencies.callbacks?.onToolStream?.(name, chunk, stream); } catch { /* noop */ }
                emitRecord('tool.output', {
                    source: 'agent',
                    provider: dependencies.agentName ?? 'xqoder-agent',
                    tool: name,
                    output: chunk,
                    partial: true,
                    ...(stream ? { stream } : {}),
                });
            },
            onToolEnd: (name, result, success) => {
                try { dependencies.callbacks?.onToolEnd?.(name, result, success); } catch { /* noop */ }
                emitRecord('tool.output', {
                    source: 'agent',
                    provider: dependencies.agentName ?? 'xqoder-agent',
                    tool: name,
                    output: result,
                });
                emitRecord('tool.completed', {
                    source: 'agent',
                    provider: dependencies.agentName ?? 'xqoder-agent',
                    tool: name,
                    success,
                });
                emitRecord('status.changed', {
                    source: 'agent',
                    status: 'thinking',
                });
            },
            onToolApproval: async (request) => {
                const requestId = String((request as { toolCallId?: unknown })?.toolCallId ?? `approval-${Date.now()}`);
                const normalizedRequest: ToolApprovalRequest = {
                    ...request,
                    toolCallId: requestId,
                    toolName: String((request as { toolName?: unknown })?.toolName ?? 'tool'),
                    summary: String((request as { summary?: unknown })?.summary ?? 'Tool approval requested'),
                };
                emitRecord('approval.requested', {
                    source: 'agent',
                    requestId,
                    kind: 'tool',
                    summary: normalizedRequest.summary,
                    payload: normalizedRequest as unknown as JsonValue,
                });
                const approved = await Promise.resolve(dependencies.callbacks?.onToolApproval?.(normalizedRequest) ?? true);
                emitRecord('approval.resolved', {
                    source: 'agent',
                    requestId,
                    decision: approved ? 'allow' : 'deny',
                });
                return approved;
            },
            onQuestion: async (prompt) => {
                emitRecord('question.requested', {
                    source: 'agent',
                    requestId: prompt.requestId,
                    question: prompt.question,
                    ...(prompt.header ? { header: prompt.header } : {}),
                    options: prompt.options,
                    ...(prompt.multiple ? { multiple: true } : {}),
                    ...(prompt.allowCustom ? { allowCustom: true } : {}),
                });

                const answer = dependencies.callbacks?.onQuestion
                    ? await Promise.resolve(dependencies.callbacks.onQuestion(prompt))
                    : {
                        requestId: prompt.requestId,
                        selected: prompt.options.length > 0 ? [prompt.options[0]!.label] : [],
                    };

                emitRecord('question.resolved', {
                    source: 'agent',
                    requestId: prompt.requestId,
                    selected: answer.selected ?? [],
                    ...(answer.customText ? { customText: answer.customText } : {}),
                    answerSource: dependencies.callbacks?.onQuestion ? 'ui' : 'fallback',
                });
                return answer;
            },
            onComplete: (message) => {
                try { dependencies.callbacks?.onComplete?.(message); } catch { /* noop */ }
            },
            onError: (error) => {
                try { dependencies.callbacks?.onError?.(error); } catch { /* noop */ }
            },
            onStop: (stopReason) => {
                try { dependencies.callbacks?.onStop?.(stopReason); } catch { /* noop */ }
            },
            onEvent: (event) => {
                try { dependencies.callbacks?.onEvent?.(event); } catch { /* noop */ }
            },
        };

        try {
            const result = await executeConversationTurn({
                ...dependencies,
                callbacks,
                emit: (type, data, streamId) => {
                    dependencies.emit(type, data, streamId);
                    if (type === 'usage') {
                        const usage = data as AgentEvents['usage'];
                        emitRecord('usage', {
                            source: 'agent',
                            model: usage.model,
                            promptTokens: usage.promptTokens,
                            completionTokens: usage.completionTokens,
                            totalTokens: usage.totalTokens,
                            ...(usage.cost !== undefined ? { cost: usage.cost } : {}),
                        });
                        return;
                    }
                    if (type === 'verification') {
                        const verification = data as AgentEvents['verification'];
                        emitRecord('verification.completed', {
                            source: 'agent',
                            ok: verification.ok,
                            blocked: verification.blocked,
                            summary: verification.summary,
                        });
                    }
                },
            });

            ensureAssistantStarted();
            emitRecord('message.completed', {
                source: 'agent',
                message: {
                    id: assistantMessageId,
                    sessionId,
                    role: 'assistant',
                    content: result.response,
                    createdAt: Date.now(),
                },
            });
            emitRecord('status.changed', {
                source: 'agent',
                status: 'done',
                stopReason: result.stopReason,
            });
            return {
                ...result,
                response: result.response,
            };
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            const stopReason = error instanceof ConversationEngineStopError
                ? error.stopReason
                : 'provider_error';
            emitRecord('error', {
                source: 'agent',
                message: normalizedError.message,
                recoverable: false,
                stopReason,
            });
            emitRecord('status.changed', {
                source: 'agent',
                status: 'error',
                stopReason,
                message: normalizedError.message,
            });
            throw normalizedError;
        } finally {
            eventQueue.close();
        }
    })();

    return {
        events: eventQueue,
        completed,
    };
}

function emitVerificationEvent(
    verification: VerificationGateResult,
    dependencies: ConversationEngineDependencies,
): void {
    const signal = verification.signal;
    if (!verification.triggered || !signal) {
        return;
    }

    dependencies.emit('verification', {
        ok: signal.ok,
        blocked: signal.blocked,
        summary: signal.summary,
    }, dependencies.streamId);
}

function recordToolFollowUpResult(
    followUp: ToolFollowUpResult,
    dependencies: ConversationEngineDependencies,
): string | undefined {
    for (const execution of followUp.executions) {
        dependencies.session.recordCheckpoint({
            toolCallId: execution.id,
            toolName: execution.name,
            required: execution.checkpoint.required,
            status: execution.checkpoint.status,
            rollbackPointId: execution.checkpoint.rollbackPointId,
            timestamp: execution.toolHistoryEntry?.completedAt
                ?? execution.fileChanges.at(-1)?.timestamp
                ?? new Date(),
        });
    }
    dependencies.session.recordToolResultArtifacts({
        rendererEvents: followUp.rendererEvents,
        transcriptEntries: followUp.transcriptEntries.filter((entry) => entry.type === 'tool'),
        eventStoreRecords: followUp.eventStoreRecords,
    });
    emitVerificationEvent(followUp.verification, dependencies);
    return resolvePermissionDeniedStopMessage(followUp.executions);
}

function assertProgressOnBlockedContinuation(input: {
    blocker: string;
    assistantContent: string;
    dependencies: ConversationEngineDependencies;
    lastFingerprint: string | undefined;
    stopReason: ConversationEngineStopError['stopReason'];
}): void {
    const continuationFingerprint = createBlockedContinuationFingerprint(
        input.blocker,
        input.assistantContent,
    );
    if (continuationFingerprint !== input.lastFingerprint) {
        return;
    }

    throw createStopError(
        `No progress detected while waiting on blocker: ${input.blocker}`,
        {
            stopReason: input.stopReason,
            agentEndReason: 'failed',
        },
        input.dependencies,
    );
}

function resolvePermissionDeniedStopMessage(
    executions: Array<{ name: string; stopReason?: ConversationStopReason; toolHistoryEntry?: { error?: string } }>,
): string | undefined {
    const deniedExecution = executions.find((execution) => execution.stopReason === 'permission_denied');
    if (!deniedExecution) {
        return undefined;
    }

    return deniedExecution.toolHistoryEntry?.error
        ?? `Tool "${deniedExecution.name}" was denied by the active permission policy`;
}

function createBlockedContinuationFingerprint(
    blocker: string,
    assistantContent: string,
): string {
    return `${normalizeContinuationField(blocker)}::${normalizeContinuationField(assistantContent)}`;
}

function resolveForcedStopDirective(
    runtime: ConversationRuntimeLike | undefined,
): ConversationForcedStopDirective | undefined {
    if (!runtime) {
        return undefined;
    }

    const directive = runtime.getForcedStopDirective?.();
    if (directive) {
        return directive;
    }

    const legacyMessage = runtime.getForcedStopMessage?.();
    if (!legacyMessage) {
        return undefined;
    }

    return {
        stopReason: legacyMessage.includes('timeout') ? 'max_wall_time' : 'max_turns',
        message: legacyMessage,
    };
}

function createToolCallBatchFingerprint(toolCalls: ToolCall[]): string {
    return toolCalls
        .map((toolCall) => `${toolCall.name}:${normalizeToolArguments(toolCall.arguments)}`)
        .join('|');
}

function describeToolCallBatch(toolCalls: ToolCall[]): string {
    return toolCalls
        .map((toolCall) => `${toolCall.name}(${normalizeToolArguments(toolCall.arguments)})`)
        .join(', ');
}

function createReadOnlyRecoveryToolCall(input: {
    blocker: string;
    dependencies: ConversationEngineDependencies;
    iteration: number;
}): ToolCall | undefined {
    const toolNames = new Set(input.dependencies.getToolDefinitions().map((definition) => definition.name));

    if (toolNames.has('read_file')) {
        const readFileCall = createRecoveryToolCallFromExactInstruction({
            blocker: input.blocker,
            toolName: 'read_file',
            id: `runtime-recovery-read-file-${input.iteration}`,
            isValidArguments: isReadFileRecoveryArguments,
        });
        if (readFileCall) {
            return readFileCall;
        }
    }

    if (toolNames.has('inspect_github_repo')) {
        const inspectGitHubRepoCall = createRecoveryToolCallFromExactInstruction({
            blocker: input.blocker,
            toolName: 'inspect_github_repo',
            id: `runtime-recovery-inspect-github-repo-${input.iteration}`,
            isValidArguments: isInspectGitHubRepoRecoveryArguments,
        });
        if (inspectGitHubRepoCall) {
            return inspectGitHubRepoCall;
        }
    }

    if (toolNames.has('fetch_url')) {
        return createRecoveryToolCallFromExactInstruction({
            blocker: input.blocker,
            toolName: 'fetch_url',
            id: `runtime-recovery-fetch-url-${input.iteration}`,
            isValidArguments: isFetchUrlRecoveryArguments,
        });
    }

    return undefined;
}

function createRecoveryToolCallFromExactInstruction(input: {
    blocker: string;
    toolName: 'read_file' | 'inspect_github_repo' | 'fetch_url';
    id: string;
    isValidArguments: (value: unknown) => value is Record<string, unknown>;
}): ToolCall | undefined {
    const line = input.blocker
        .split(/\r?\n/)
        .find((entry) => entry.includes(`Prefer this exact call: ${input.toolName}`));
    const match = line?.match(new RegExp(`Prefer this exact call:\\s*${input.toolName}\\s+(.+)$`));
    if (!match) {
        return undefined;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(match[1]!.trim());
    } catch {
        return undefined;
    }
    if (!input.isValidArguments(parsed)) {
        return undefined;
    }

    return {
        id: input.id,
        name: input.toolName,
        arguments: JSON.stringify(parsed),
    };
}

function isReadFileRecoveryArguments(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const args = value as Record<string, unknown>;
    return typeof args.path === 'string'
        && (args.startLine === undefined || typeof args.startLine === 'number')
        && (args.endLine === undefined || typeof args.endLine === 'number');
}

function isInspectGitHubRepoRecoveryArguments(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const args = value as Record<string, unknown>;
    return typeof args.url === 'string'
        && /^https:\/\/(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+/i.test(args.url)
        && (args.ref === undefined || typeof args.ref === 'string')
        && (args.maxFiles === undefined || typeof args.maxFiles === 'number');
}

function isFetchUrlRecoveryArguments(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const args = value as Record<string, unknown>;
    return typeof args.url === 'string'
        && /^https?:\/\//i.test(args.url)
        && (args.format === undefined || ['text', 'markdown', 'html'].includes(String(args.format)))
        && (args.timeout === undefined || typeof args.timeout === 'number');
}

function normalizeToolArguments(argumentsText: string | undefined): string {
    if (!argumentsText?.trim()) {
        return '{}';
    }

    try {
        return stableStringify(JSON.parse(argumentsText) as unknown);
    } catch {
        return argumentsText.trim();
    }
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

function normalizeContinuationField(value: string | undefined): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function requestAssistantTurn(
    dependencies: ConversationEngineDependencies,
    runtime: ConversationRuntimeLike | undefined,
    toolUsedInCurrentRun: boolean,
): Promise<ProviderTurnResult> {
    const messages = runtime ? runtime.prepareMessages() : dependencies.session.getMessages();
    const request: CompletionRequest = {
        messages,
        tools: dependencies.getToolDefinitions(),
    };
    const suppressAssistantMessages = runtime?.shouldDeferAssistantOutput?.(toolUsedInCurrentRun) ?? false;

    return await runProviderTurn({
        provider: dependencies.provider,
        request,
        session: dependencies.session,
        llmConfig: dependencies.llmConfig,
        agentName: dependencies.agentName,
        streamId: dependencies.streamId,
        callbacks: dependencies.callbacks,
        suppressAssistantMessages,
        emit: dependencies.emit,
    });
}

async function maybeAutoCompact(
    usage: ProviderTurnResult['usage'],
    dependencies: ConversationEngineDependencies,
): Promise<void> {
    const ctxWindow = getContextWindow(dependencies.llmConfig.model);
    if (
        dependencies.runtimeProfile === 'mvp'
        || dependencies.compaction?.auto === false
        || !ctxWindow
        || usage.promptTokens < ctxWindow * 0.85
    ) {
        return;
    }

    dependencies.logger.warn(`Context usage at ${Math.round(usage.promptTokens / ctxWindow * 100)}%, triggering auto-compact`);
    try {
        const messages = dependencies.session.getMessages().filter((message) => message.role !== 'system');
        const { SummarizerAgent } = await import('@xqoder/agent');
        const summaryAgent = new SummarizerAgent(dependencies.llmConfig);
        const summary = await summaryAgent.summarize(messages);
        dependencies.session.performCompaction(summary);
        dependencies.emit('message', { role: 'system', content: `[Auto-compacted context summary]: ${summary}` }, dependencies.streamId);
        try { dependencies.callbacks?.onToolEnd?.('auto_compact', summary, true); } catch { /* noop */ }
    } catch (err) {
        dependencies.logger.error(`Auto-compact failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

function createStopError(
    message: string,
    options: {
        stopReason: ConversationEngineStopError['stopReason'];
        agentEndReason: ConversationEngineStopError['agentEndReason'];
    },
    dependencies: ConversationEngineDependencies,
): ConversationEngineStopError {
    dependencies.emit('error', { message, fatal: true }, dependencies.streamId);
    return new ConversationEngineStopError(message, options);
}

function emitAgentEnd(
    dependencies: ConversationEngineDependencies,
    reason: 'completed' | 'aborted',
    stopReason: Extract<ConversationStopReason, 'completed' | 'max_turns' | 'max_wall_time' | 'user_cancelled'>,
): void {
    dependencies.emit(
        'agent_end',
        {
            streamId: dependencies.streamId,
            reason,
            summary: stopReason,
        },
        dependencies.streamId,
    );
}

function isWallTimeExceeded(
    startedAt: number,
    now: number,
    maxWallTimeMs: number | undefined,
): boolean {
    return maxWallTimeMs !== undefined
        && maxWallTimeMs >= 0
        && now - startedAt > maxWallTimeMs;
}

function resolveMaxTurns(
    dependencies: Pick<ConversationEngineDependencies, 'maxTurns' | 'maxIterations'>,
): number {
    return dependencies.maxTurns ?? dependencies.maxIterations ?? 20;
}
