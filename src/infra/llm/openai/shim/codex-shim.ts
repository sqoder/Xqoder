// CodexShimProvider — variant of OpenAIShimProvider for the codex-family
// aliases (`codexplan`, `gpt-5`, `gpt-5.1-codex`, ...). Differs from the
// chat-completions path on three axes:
//
//   1. Endpoint: uses `/responses` rather than `/chat/completions`.
//   2. Prompting: merges all `system` messages into the first `user` turn,
//      because `/responses` takes a flat `input` array, not messages+system.
//   3. Reasoning: expects `reasoning.effort`, not `reasoning_effort`.
//
// The stream shape is the OpenAI Responses event protocol
// (`response.output_text.delta`, `response.function_call_arguments.delta`,
// `response.completed`, ...). We keep the parser structural so tests can
// drive with plain objects instead of the SDK.
//
// Gated by `XQODER_FEATURE_CODEX_SHIM=1`. Factory falls back to the chat
// path when the flag is off — safe default for aggregator proxies that
// don't forward `/responses`.

import OpenAI from 'openai';
import type {
    LLMMessage,
    LLMProviderCapabilities,
    LLMProviderConfig,
    LLMProviderName,
    StreamCallbacks,
    ToolCall,
    ToolDefinition,
} from '@xqoder/shared';
import { LLMError, resolveLLMProviderCapabilities } from '@xqoder/shared';
import {
    BaseLLMProvider,
    type CompletionRequest,
    type CompletionResponse,
} from '@xqoder/llm-api';
import { isClassifiedLLMError, withRetry, wrapStream } from '../../retry/index.js';
import { resolveProxyForProvider } from '../../../../shared/network-proxy.js';
import { toCodexReasoningParams } from '../../../../shared/thinking/index.js';
import { convertTools } from './convert-tools.js';
import { ThinkTagFilter } from './think-tag-filter.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export interface CodexResponsesClient {
    readonly responses: {
        create(params: unknown, options?: unknown): unknown;
    };
}

export interface CodexShimProviderDeps {
    readonly client?: CodexResponsesClient;
    readonly timeoutMs?: number;
    readonly env?: NodeJS.ProcessEnv;
}

export class CodexShimProvider extends BaseLLMProvider {
    override readonly name: LLMProviderName;
    private readonly client: CodexResponsesClient;
    private readonly timeoutMs: number;
    private readonly capabilities: LLMProviderCapabilities;

    constructor(config: LLMProviderConfig, deps: CodexShimProviderDeps = {}) {
        super(config);
        this.name = config.provider;
        this.timeoutMs = deps.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.capabilities = resolveLLMProviderCapabilities(config);
        this.client = deps.client ?? (this.buildClient(config, deps.env) as unknown as CodexResponsesClient);
    }

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
        return this.stream(request, {});
    }

    async stream(request: CompletionRequest, callbacks: StreamCallbacks): Promise<CompletionResponse> {
        let streamRef: AsyncIterable<CodexStreamEvent> | undefined;
        try {
            streamRef = await withRetry(
                { providerName: this.name, foreground: true },
                async () => {
                    const params = this.buildRequestParams(request);
                    const created = (await this.client.responses.create(
                        params,
                        { timeout: this.timeoutMs },
                    )) as unknown;
                    return created as AsyncIterable<CodexStreamEvent>;
                },
            );
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            callbacks.onError?.(error);
            if (isClassifiedLLMError(err)) throw err;
            throw new LLMError(
                `${this.name} stream connection failed: ${error.message}`,
                this.name,
                err instanceof OpenAI.APIError ? err.status : undefined,
            );
        }

        try {
            const wrapped = wrapStream(streamRef, { providerName: this.name });
            return await codexStreamToInternal(
                wrapped as AsyncIterable<CodexStreamEvent>,
                callbacks,
                { thinkTagFilter: new ThinkTagFilter() },
            );
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            try { callbacks.onError?.(error); } catch { /* noop */ }
            if (isClassifiedLLMError(err)) throw err;
            throw new LLMError(`${this.name} stream call failed: ${error.message}`, this.name);
        }
    }

    protected formatTools(tools: ToolDefinition[]): unknown[] {
        return convertTools(tools, { strict: this.capabilities.supportsStrictTools });
    }

    private buildRequestParams(request: CompletionRequest): CodexResponseCreateParams {
        const input = buildCodexInput(request.messages as LLMMessage[]);
        const tools = request.tools
            ? convertTools(request.tools, { strict: this.capabilities.supportsStrictTools })
            : undefined;
        const reasoning = toCodexReasoningParams(request.thinking);
        return {
            model: this.model,
            input,
            stream: true,
            reasoning: (reasoning.reasoning ?? { effort: 'medium' }) as { effort: 'low' | 'medium' | 'high' },
            tools: tools as unknown[] | undefined,
            max_output_tokens: request.maxTokens ?? this.maxTokens,
        };
    }

    private buildClient(config: LLMProviderConfig, env: NodeJS.ProcessEnv | undefined): OpenAI {
        const proxy = resolveProxyForProvider({
            provider: config.provider,
            baseUrl: config.baseUrl,
            env,
        });
        const opts: ConstructorParameters<typeof OpenAI>[0] = {
            apiKey: config.apiKey,
            baseURL: config.baseUrl,
            timeout: this.timeoutMs,
        };
        if (proxy.proxyUrl) {
            (opts as { fetchOptions?: Record<string, unknown> }).fetchOptions = { proxy: proxy.proxyUrl };
        }
        return new OpenAI(opts);
    }
}

export interface CodexResponseCreateParams {
    readonly model: string;
    readonly input: CodexInputItem[];
    readonly stream: true;
    readonly reasoning?: { effort: 'low' | 'medium' | 'high' };
    readonly tools?: unknown[];
    readonly max_output_tokens?: number;
}

export type CodexInputItem =
    | { role: 'user' | 'assistant'; content: string }
    | { type: 'function_call'; call_id: string; name: string; arguments: string }
    | { type: 'function_call_output'; call_id: string; output: string };

/**
 * Fold a ChatCompletion-style message array into /responses `input`:
 * - Every `system` is concatenated and merged into the first user turn.
 * - Assistant tool calls become `function_call` items.
 * - Tool results become `function_call_output` items.
 */
export function buildCodexInput(messages: LLMMessage[]): CodexInputItem[] {
    const systemText = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .filter(Boolean)
        .join('\n\n');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    const out: CodexInputItem[] = [];
    let systemMerged = systemText.length === 0;

    for (const m of nonSystem) {
        if (m.role === 'user') {
            if (!systemMerged) {
                out.push({ role: 'user', content: `${systemText}\n\n${m.content}` });
                systemMerged = true;
            } else {
                out.push({ role: 'user', content: m.content });
            }
            continue;
        }
        if (m.role === 'assistant') {
            if (m.content.length > 0) {
                out.push({ role: 'assistant', content: m.content });
            }
            if (m.toolCalls) {
                for (const tc of m.toolCalls) {
                    out.push({
                        type: 'function_call',
                        call_id: tc.id,
                        name: tc.name,
                        arguments: tc.arguments,
                    });
                }
            }
            continue;
        }
        if (m.role === 'tool') {
            out.push({
                type: 'function_call_output',
                call_id: m.toolCallId ?? '',
                output: m.content,
            });
            continue;
        }
    }

    if (!systemMerged && systemText) {
        out.unshift({ role: 'user', content: systemText });
    }

    return out;
}

// ---- stream parsing (structural, no SDK import) ----

export type CodexStreamEvent =
    | { type: 'response.output_text.delta'; delta: string; item_id?: string }
    | { type: 'response.reasoning_text.delta'; delta: string; item_id?: string }
    | { type: 'response.function_call_arguments.delta'; item_id: string; delta: string }
    | { type: 'response.output_item.added'; item: CodexOutputItem }
    | { type: 'response.output_item.done'; item: CodexOutputItem }
    | { type: 'response.completed'; response?: { usage?: CodexUsage } }
    | { type: string; [k: string]: unknown };

export interface CodexOutputItem {
    readonly id?: string;
    readonly type?: string;
    readonly call_id?: string;
    readonly name?: string;
    readonly arguments?: string;
}

export interface CodexUsage {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly total_tokens?: number;
}

export interface CodexStreamParserOptions {
    readonly thinkTagFilter?: ThinkTagFilter;
}

export async function codexStreamToInternal(
    stream: AsyncIterable<CodexStreamEvent>,
    callbacks: StreamCallbacks,
    options: CodexStreamParserOptions = {},
): Promise<CompletionResponse> {
    const toolAccum = new Map<string, { id: string; name: string; args: string }>();
    let content = '';
    let thinking = '';
    let usage: CompletionResponse['usage'] = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
    };
    let finishReason: CompletionResponse['finishReason'] = 'stop';
    let sawToolCall = false;

    for await (const event of stream) {
        switch (event.type) {
            case 'response.output_text.delta': {
                const delta = typeof event.delta === 'string' ? event.delta : '';
                if (!delta) break;
                const visible = options.thinkTagFilter
                    ? options.thinkTagFilter.push(delta)
                    : delta;
                if (visible.length > 0) {
                    content += visible;
                    safeEmit(() => callbacks.onToken?.(visible));
                }
                break;
            }
            case 'response.reasoning_text.delta':
            case 'response.reasoning_summary_text.delta': {
                const delta = typeof event.delta === 'string' ? event.delta : '';
                if (!delta) break;
                thinking += delta;
                safeEmit(() => callbacks.onThinkingToken?.(delta));
                break;
            }
            case 'response.output_item.added': {
                const item = (event as { item?: CodexOutputItem }).item;
                if (item?.type === 'function_call' && item.call_id) {
                    toolAccum.set(item.call_id, {
                        id: item.call_id,
                        name: item.name ?? '',
                        args: item.arguments ?? '',
                    });
                }
                break;
            }
            case 'response.function_call_arguments.delta': {
                const key = (event as { item_id?: string }).item_id;
                const delta = typeof (event as { delta?: unknown }).delta === 'string'
                    ? (event as { delta: string }).delta
                    : '';
                if (!key || !delta) break;
                const existing = toolAccum.get(key) ?? { id: key, name: '', args: '' };
                existing.args += delta;
                toolAccum.set(key, existing);
                break;
            }
            case 'response.output_item.done': {
                const item = (event as { item?: CodexOutputItem }).item;
                if (item?.type === 'function_call' && item.call_id) {
                    const existing = toolAccum.get(item.call_id) ?? {
                        id: item.call_id,
                        name: item.name ?? '',
                        args: '',
                    };
                    if (item.name) existing.name = item.name;
                    if (item.arguments && existing.args.length === 0) existing.args = item.arguments;
                    toolAccum.set(item.call_id, existing);
                    sawToolCall = true;
                }
                break;
            }
            case 'response.completed': {
                const u = (event as { response?: { usage?: CodexUsage } }).response?.usage;
                if (u) {
                    usage = {
                        promptTokens: u.input_tokens ?? 0,
                        completionTokens: u.output_tokens ?? 0,
                        totalTokens: u.total_tokens ?? ((u.input_tokens ?? 0) + (u.output_tokens ?? 0)),
                    };
                }
                break;
            }
            default:
                break;
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
    for (const buf of toolAccum.values()) {
        if (!buf.name && !buf.args) continue;
        const tc: ToolCall = {
            id: buf.id,
            name: buf.name,
            arguments: buf.args,
        };
        toolCalls.push(tc);
        safeEmit(() => callbacks.onToolCall?.(tc));
    }

    if (sawToolCall || toolCalls.length > 0) finishReason = 'tool_calls';

    const message = {
        role: 'assistant' as const,
        content,
        ...(thinking.length > 0 ? { thinking } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };

    safeEmit(() => callbacks.onComplete?.(message));
    return { message, usage, finishReason };
}

function safeEmit(fn: () => void): void {
    try { fn(); } catch { /* callbacks must not break the stream */ }
}
