import { calculateCost, type LLMProviderConfig, type StreamCallbacks } from '@xqoder/shared';
import type { AgentEvents, AgentSession } from '@xqoder/agent';
import {
    streamProviderEvents,
    type CompletionRequest,
    type ILLMProvider,
    type ConversationProviderEvent,
    type ConversationProviderFinishReason,
    type ConversationProviderUsage,
} from '@xqoder/llm-api';
import { buildLocalFallbackGuidance } from '../../shared/local-fallback.js';
import { ConversationEngineStopError } from './turn-stop.js';

export interface ProviderTurnResult {
    message: CompletionRequest['messages'][number];
    usage: ConversationProviderUsage;
    finishReason: ConversationProviderFinishReason;
}

export interface ProviderTurnDependencies {
    provider: ILLMProvider;
    request: CompletionRequest;
    session: AgentSession;
    llmConfig: LLMProviderConfig;
    agentName?: string;
    streamId: string;
    callbacks?: StreamCallbacks;
    suppressAssistantMessages?: boolean;
    emit: <K extends keyof AgentEvents>(
        type: K,
        data: AgentEvents[K],
        streamId?: string,
    ) => void;
}

interface ProviderTurnState {
    lastError?: Error;
    message?: ProviderTurnResult['message'];
    usage?: ConversationProviderUsage;
    finishReason?: ConversationProviderFinishReason;
}

export async function runProviderTurn(
    dependencies: ProviderTurnDependencies,
): Promise<ProviderTurnResult> {
    const state: ProviderTurnState = {};
    const providerTurn = streamProviderEvents({
        provider: dependencies.provider,
        request: dependencies.request,
    });

    try {
        for await (const event of providerTurn.events) {
            applyProviderEvent(event, dependencies, state);
        }
        await providerTurn.completed;
    } catch (error) {
        throw await buildProviderCallError(state.lastError ?? error, dependencies);
    }

    if (!state.usage || !state.message || !state.finishReason) {
        throw await buildProviderCallError(
            new Error('Provider stream ended without usage or message_stop'),
            dependencies,
        );
    }

    return {
        message: state.message,
        usage: state.usage,
        finishReason: state.finishReason,
    };
}

function applyProviderEvent(
    event: ConversationProviderEvent,
    dependencies: ProviderTurnDependencies,
    state: ProviderTurnState,
): void {
    switch (event.type) {
        case 'message':
            if (dependencies.suppressAssistantMessages === true) {
                return;
            }
            dependencies.emit('message', { role: 'assistant', content: event.text }, dependencies.streamId);
            try { dependencies.callbacks?.onToken?.(event.text); } catch { /* noop */ }
            return;
        case 'reasoning':
            dependencies.emit('thought', { content: event.text }, dependencies.streamId);
            try { dependencies.callbacks?.onThinkingToken?.(event.text); } catch { /* noop */ }
            return;
        case 'tool':
            try { dependencies.callbacks?.onToolCall?.(event.toolCall); } catch { /* noop */ }
            return;
        case 'usage':
            recordUsage(event.usage, dependencies);
            state.usage = event.usage;
            return;
        case 'stop':
            state.message = event.message;
            state.finishReason = event.finishReason;
            if (dependencies.suppressAssistantMessages === true) {
                return;
            }
            try { dependencies.callbacks?.onComplete?.(event.message); } catch { /* noop */ }
            return;
        case 'error':
            state.lastError = event.error;
            try { dependencies.callbacks?.onError?.(event.error); } catch { /* noop */ }
            return;
    }
}

function recordUsage(
    usage: ConversationProviderUsage,
    dependencies: ProviderTurnDependencies,
): void {
    const cost = calculateCost(dependencies.llmConfig.model, usage);
    dependencies.session.recordUsage({ ...usage, cost });
    dependencies.emit('usage', {
        model: dependencies.llmConfig.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        cost,
    }, dependencies.streamId);
}

async function buildProviderCallError(
    error: unknown,
    dependencies: ProviderTurnDependencies,
): Promise<ConversationEngineStopError> {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const baseMessage = `LLM call failed: ${normalizedError.message}`;
    const guidance = await buildLocalFallbackGuidance({
        error: new Error(baseMessage),
        llmConfig: dependencies.llmConfig,
        agentName: dependencies.agentName,
    });
    const msg = guidance ? `${baseMessage}\n\n${guidance}` : baseMessage;
    dependencies.emit('error', { message: msg, fatal: true }, dependencies.streamId);
    return new ConversationEngineStopError(msg, {
        stopReason: 'provider_error',
        agentEndReason: 'error',
    });
}
