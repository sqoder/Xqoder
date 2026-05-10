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
    type ToolFollowUpResult,
} from './tool-follow-up.js';
import {
    ConversationEngineResult,
    ConversationEngineStopError,
    ConversationStopReason,
} from './turn-stop.js';
import type { VerificationGateResult } from './verification-gate.js';
import type { ConversationTurnInput } from './turn-intake.js';
import type { ToolExecutionPort } from '../../domain/conversation/tool-execution-port.js';
import {
    detectNoProgressOnBlocker,
    resolvePermissionDeniedStopMessage,
} from './query-stop-hooks.js';
import { runQueryLoop } from './query-loop.js';
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
 *
 * The iteration body lives in query-loop.ts. This wrapper injects the hooks
 * that still need session/event-emitter access.
 */
async function executeConversationTurn(
    dependencies: ConversationEngineDependencies,
): Promise<ConversationEngineResult> {
    return await runQueryLoop(dependencies, {
        createStopError: (message, options) => createStopError(message, options, dependencies),
        emitAgentEnd: (reason, stopReason) => emitAgentEnd(dependencies, reason, stopReason),
        recordToolFollowUpResult: (followUp) => recordToolFollowUpResult(followUp, dependencies),
        assertProgressOnBlockedContinuation: (input) => assertProgressOnBlockedContinuation({
            blocker: input.blocker,
            assistantContent: input.assistantContent,
            dependencies,
            lastFingerprint: input.lastFingerprint,
            stopReason: input.stopReason,
        }),
    });
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
    stopReason: Extract<ConversationStopReason, 'no_progress' | 'verification_failed'>;
}): void {
    const directive = detectNoProgressOnBlocker({
        blocker: input.blocker,
        assistantContent: input.assistantContent,
        lastFingerprint: input.lastFingerprint,
        stopReason: input.stopReason,
    });
    if (!directive) {
        return;
    }
    throw createStopError(
        directive.message,
        { stopReason: directive.stopReason, agentEndReason: directive.agentEndReason },
        input.dependencies,
    );
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
