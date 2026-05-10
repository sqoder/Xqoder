// Reads an OpenAI-style streaming response (AsyncIterable of ChatCompletionChunk-like
// objects) and drives XQoder StreamCallbacks + produces a final CompletionResponse.
// Kept provider-agnostic: we do not import the openai SDK; instead we accept
// a structural interface so tests can drive with plain objects.

import type {
    StreamCallbacks,
    ToolCall,
} from '@xqoder/shared';
import type { CompletionResponse } from '@xqoder/llm-api';
import type { ThinkTagFilter } from './think-tag-filter.js';

export interface OpenAIStreamChunk {
    readonly choices?: ReadonlyArray<{
        readonly index?: number;
        readonly delta?: {
            readonly role?: string;
            readonly content?: string | null;
            readonly reasoning_content?: string | null;
            readonly tool_calls?: ReadonlyArray<{
                readonly index: number;
                readonly id?: string;
                readonly type?: 'function';
                readonly function?: {
                    readonly name?: string;
                    readonly arguments?: string;
                };
            }>;
        };
        readonly finish_reason?: string | null;
    }>;
    readonly usage?: {
        readonly prompt_tokens?: number;
        readonly completion_tokens?: number;
        readonly total_tokens?: number;
    };
}

export interface StreamParserOptions {
    readonly thinkTagFilter?: ThinkTagFilter;
}

export async function openaiStreamToInternal(
    stream: AsyncIterable<OpenAIStreamChunk>,
    callbacks: StreamCallbacks,
    options: StreamParserOptions = {},
): Promise<CompletionResponse> {
    const toolAccum = new Map<number, { id: string; name: string; args: string }>();
    let content = '';
    let thinking = '';
    let finishReason: CompletionResponse['finishReason'] = 'stop';
    let usage: CompletionResponse['usage'] = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
    };

    for await (const chunk of stream) {
        if (chunk.usage) {
            usage = {
                promptTokens: chunk.usage.prompt_tokens ?? 0,
                completionTokens: chunk.usage.completion_tokens ?? 0,
                totalTokens: chunk.usage.total_tokens ?? 0,
            };
        }

        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (delta) {
            if (typeof delta.content === 'string' && delta.content.length > 0) {
                const visible = options.thinkTagFilter
                    ? options.thinkTagFilter.push(delta.content)
                    : delta.content;
                if (visible.length > 0) {
                    content += visible;
                    safeEmit(() => callbacks.onToken?.(visible));
                }
            }
            if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
                thinking += delta.reasoning_content;
                safeEmit(() => callbacks.onThinkingToken?.(delta.reasoning_content!));
            }
            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const existing = toolAccum.get(tc.index) ?? { id: '', name: '', args: '' };
                    if (tc.id) existing.id = tc.id;
                    if (tc.function?.name) existing.name = tc.function.name;
                    if (tc.function?.arguments) existing.args += tc.function.arguments;
                    toolAccum.set(tc.index, existing);
                }
            }
        }

        if (choice?.finish_reason) {
            finishReason = mapFinishReason(choice.finish_reason);
        }
    }

    if (options.thinkTagFilter) {
        const tail = options.thinkTagFilter.flush();
        if (tail.length > 0) {
            content += tail;
            safeEmit(() => callbacks.onToken?.(tail));
        }
    }

    const toolCalls: ToolCall[] = [];
    for (const [, buf] of [...toolAccum.entries()].sort(([a], [b]) => a - b)) {
        if (!buf.id && !buf.name) continue;
        const toolCall: ToolCall = {
            id: buf.id || `call_${toolCalls.length}`,
            name: buf.name,
            arguments: buf.args,
        };
        toolCalls.push(toolCall);
        safeEmit(() => callbacks.onToolCall?.(toolCall));
    }

    const message = {
        role: 'assistant' as const,
        content,
        ...(thinking.length > 0 ? { thinking } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };

    safeEmit(() => callbacks.onComplete?.(message));

    return { message, usage, finishReason };
}

function mapFinishReason(reason: string): CompletionResponse['finishReason'] {
    switch (reason) {
        case 'tool_calls':
            return 'tool_calls';
        case 'length':
            return 'length';
        case 'stop':
            return 'stop';
        default:
            return 'stop';
    }
}

function safeEmit(fn: () => void): void {
    try { fn(); } catch { /* callbacks must not break the stream */ }
}
