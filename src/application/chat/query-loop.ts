// P09 sub-PR 3: extracted main iteration loop.
//
// conversation-engine.ts used to own the while(iteration < maxTurns) body plus
// the read-only recovery tool-call builder. Both are pulled here so the
// application file is left with only stream wiring + side-effect hooks.
//
// Hooks (createStopError / emitAgentEnd / recordToolFollowUpResult /
// assertProgressOnBlockedContinuation) stay in the application layer because
// they touch session state, event emission, and envelope mutation. The loop
// receives them as injected callbacks — keeping this module framework-free.

import type { ToolCall } from '@xqoder/shared';
import {
    maybeAutoCompact,
    runTurnWithReactiveCompaction,
} from './compaction-pipeline.js';
import type { ProviderTurnResult } from './provider-turn.js';
import { runProviderTurn } from './provider-turn.js';
import {
    compactIntermediateResponse,
    removeRepeatedAssistantSections,
} from './response-cleanup.js';
import { handleToolFollowUp, type ToolFollowUpResult } from './tool-follow-up.js';
import {
    type ConversationEngineResult,
    type ConversationEngineStopError,
    type ConversationStopReason,
} from './turn-stop.js';
import type {
    ConversationEngineDependencies,
    ConversationRuntimeLike,
} from './conversation-engine.js';
import { isWallTimeExceeded, resolveMaxTurns } from './query-config.js';
import {
    createBlockedContinuationFingerprint,
    createToolCallBatchFingerprint,
    describeToolCallBatch,
    resolveForcedStopDirective,
} from './query-stop-hooks.js';

type AgentEndStopReason = Extract<
    ConversationStopReason,
    'completed' | 'max_turns' | 'max_wall_time' | 'user_cancelled'
>;

export interface QueryLoopHooks {
    readonly createStopError: (
        message: string,
        options: {
            stopReason: ConversationEngineStopError['stopReason'];
            agentEndReason: ConversationEngineStopError['agentEndReason'];
        },
    ) => ConversationEngineStopError;
    readonly emitAgentEnd: (reason: 'completed' | 'aborted', stopReason: AgentEndStopReason) => void;
    readonly recordToolFollowUpResult: (followUp: ToolFollowUpResult) => string | undefined;
    readonly assertProgressOnBlockedContinuation: (input: {
        blocker: string;
        assistantContent: string;
        lastFingerprint: string | undefined;
        stopReason: Extract<ConversationStopReason, 'no_progress' | 'verification_failed'>;
    }) => void;
}

export async function runQueryLoop(
    dependencies: ConversationEngineDependencies,
    hooks: QueryLoopHooks,
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
            hooks.emitAgentEnd('aborted', 'user_cancelled');
            return {
                response: '[cancelled by user]',
                stopReason: 'user_cancelled',
                iterations: iteration,
                toolCallCount,
            };
        }

        if (isWallTimeExceeded(startedAt, now(), dependencies.maxWallTimeMs)) {
            throw hooks.createStopError(
                `Maximum wall time reached (${dependencies.maxWallTimeMs}ms)`,
                { stopReason: 'max_wall_time', agentEndReason: 'failed' },
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
            hooks.emitAgentEnd('completed', forcedStopDirective.stopReason);
            return {
                response: forcedStopDirective.message,
                stopReason: forcedStopDirective.stopReason,
                iterations: iteration,
                toolCallCount,
            };
        }

        const toolUsedBeforeProviderTurn = dependencies.session.getToolHistory().length > toolHistoryBaseline;
        const response = await runTurnWithReactiveCompaction(
            () => requestAssistantTurn(dependencies, runtime, toolUsedBeforeProviderTurn),
            dependencies.session,
            dependencies.logger,
        );
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
                throw hooks.createStopError(
                    `Duplicate tool call batch detected: ${describeToolCallBatch(response.message.toolCalls)}`,
                    { stopReason: 'duplicate_tool_call', agentEndReason: 'failed' },
                );
            }

            lastToolCallBatchFingerprint = toolCallBatchFingerprint;
            lastBlockedContinuationFingerprint = undefined;
            const nextToolCallCount = toolCallCount + response.message.toolCalls.length;
            if (dependencies.maxToolCalls !== undefined && nextToolCallCount > dependencies.maxToolCalls) {
                throw hooks.createStopError(
                    `Maximum tool calls reached (${dependencies.maxToolCalls})`,
                    { stopReason: 'max_tool_calls', agentEndReason: 'failed' },
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
            const permissionDeniedMessage = hooks.recordToolFollowUpResult(followUp);
            if (permissionDeniedMessage) {
                throw hooks.createStopError(
                    permissionDeniedMessage,
                    { stopReason: 'permission_denied', agentEndReason: 'failed' },
                );
            }
            continue;
        }

        const toolUsedInCurrentRun = dependencies.session.getToolHistory().length > toolHistoryBaseline;
        const noToolCompletionBlocker = completionBlocker
            ? undefined
            : runtime?.getNoToolCompletionBlocker(toolUsedInCurrentRun);

        if (completionBlocker) {
            hooks.assertProgressOnBlockedContinuation({
                blocker: completionBlocker,
                assistantContent: response.message.content,
                lastFingerprint: lastBlockedContinuationFingerprint,
                stopReason: activeVerificationBlocker ? 'verification_failed' : 'no_progress',
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
            hooks.assertProgressOnBlockedContinuation({
                blocker: noToolCompletionBlocker,
                assistantContent: response.message.content,
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
                    throw hooks.createStopError(
                        `Duplicate tool call batch detected: ${describeToolCallBatch([recoveryToolCall])}`,
                        { stopReason: 'duplicate_tool_call', agentEndReason: 'failed' },
                    );
                }

                const nextToolCallCount = toolCallCount + 1;
                if (dependencies.maxToolCalls !== undefined && nextToolCallCount > dependencies.maxToolCalls) {
                    throw hooks.createStopError(
                        `Maximum tool calls reached (${dependencies.maxToolCalls})`,
                        { stopReason: 'max_tool_calls', agentEndReason: 'failed' },
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
                const permissionDeniedMessage = hooks.recordToolFollowUpResult(followUp);
                if (permissionDeniedMessage) {
                    throw hooks.createStopError(
                        permissionDeniedMessage,
                        { stopReason: 'permission_denied', agentEndReason: 'failed' },
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
        hooks.emitAgentEnd('completed', 'completed');
        return {
            response: finalContent,
            stopReason: 'completed',
            iterations: iteration,
            toolCallCount,
        };
    }

    throw hooks.createStopError(
        `Maximum turns reached (${maxTurns})`,
        { stopReason: 'max_turns', agentEndReason: 'failed' },
    );
}

async function requestAssistantTurn(
    dependencies: ConversationEngineDependencies,
    runtime: ConversationRuntimeLike | undefined,
    toolUsedInCurrentRun: boolean,
): Promise<ProviderTurnResult> {
    const messages = runtime ? runtime.prepareMessages() : dependencies.session.getMessages();
    const request = {
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
