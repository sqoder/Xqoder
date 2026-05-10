// OpenAIShimProvider: single implementation for all OpenAI-compatible
// providers (openai / dashscope / groq / xai / openrouter / local / ...).
// Composed from the pure shim utilities; Phase 01's withRetry + wrapStream
// remain the outermost resilience layer.

import OpenAI from 'openai';
import type {
    LLMMessage,
    LLMProviderCapabilities,
    LLMProviderConfig,
    LLMProviderName,
    StreamCallbacks,
    ToolDefinition,
} from '@xqoder/shared';
import { LLMError, resolveLLMProviderCapabilities } from '@xqoder/shared';
import { BaseLLMProvider, type CompletionRequest, type CompletionResponse } from '@xqoder/llm-api';
import { toOpenAIReasoningEffort } from '../../../../shared/thinking/index.js';
import { isClassifiedLLMError, withRetry, wrapStream } from '../../retry/index.js';
import { resolveProxyForProvider } from '../../../../shared/network-proxy.js';
import { convertMessages } from './convert-messages.js';
import { convertTools } from './convert-tools.js';
import { ThinkTagFilter } from './think-tag-filter.js';
import { openaiStreamToInternal, type OpenAIStreamChunk } from './stream-parser.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

interface OpenAIShimProviderDeps {
    readonly client?: Pick<OpenAI, 'chat'>;
    readonly timeoutMs?: number;
    readonly env?: NodeJS.ProcessEnv;
}

export class OpenAIShimProvider extends BaseLLMProvider {
    override readonly name: LLMProviderName;
    private readonly client: Pick<OpenAI, 'chat'>;
    private readonly timeoutMs: number;
    private readonly capabilities: LLMProviderCapabilities;

    constructor(config: LLMProviderConfig, deps: OpenAIShimProviderDeps = {}) {
        super(config);
        this.name = config.provider;
        this.timeoutMs = deps.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.capabilities = resolveLLMProviderCapabilities(config);
        this.client = deps.client ?? this.buildClient(config, deps.env);
    }

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
        return this.stream(request, {});
    }

    async stream(request: CompletionRequest, callbacks: StreamCallbacks): Promise<CompletionResponse> {
        let streamRef: AsyncIterable<OpenAIStreamChunk> | undefined;
        try {
            streamRef = await withRetry(
                { providerName: this.name, foreground: true },
                async () => {
                    const created = await this.client.chat.completions.create(
                        this.buildRequestParams(request),
                        { timeout: this.timeoutMs },
                    );
                    return created as unknown as AsyncIterable<OpenAIStreamChunk>;
                },
            );
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            callbacks.onError?.(error);
            if (isClassifiedLLMError(err)) {
                throw err;
            }
            throw new LLMError(
                `${this.name} stream connection failed: ${error.message}`,
                this.name,
                err instanceof OpenAI.APIError ? err.status : undefined,
            );
        }

        try {
            const wrapped = wrapStream(streamRef, { providerName: this.name });
            return await openaiStreamToInternal(
                wrapped as AsyncIterable<OpenAIStreamChunk>,
                callbacks,
                { thinkTagFilter: new ThinkTagFilter() },
            );
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            try { callbacks.onError?.(error); } catch { /* noop */ }
            if (isClassifiedLLMError(err)) {
                throw err;
            }
            throw new LLMError(`${this.name} stream call failed: ${error.message}`, this.name);
        }
    }

    protected formatTools(tools: ToolDefinition[]): unknown[] {
        return convertTools(tools, { strict: this.capabilities.supportsStrictTools });
    }

    private buildRequestParams(request: CompletionRequest): OpenAI.ChatCompletionCreateParams {
        const tools = request.tools
            ? convertTools(request.tools, { strict: this.capabilities.supportsStrictTools })
            : undefined;
        const messages = convertMessages(request.messages as LLMMessage[]);
        const reasoning = toOpenAIReasoningEffort(request.thinking);
        return {
            model: this.model,
            messages: messages as unknown as OpenAI.ChatCompletionMessageParam[],
            tools: tools as unknown as OpenAI.ChatCompletionTool[] | undefined,
            max_tokens: request.maxTokens ?? this.maxTokens,
            temperature: request.temperature ?? this.temperature,
            stream: true,
            stream_options: { include_usage: true },
            ...(reasoning.reasoning_effort
                ? ({ reasoning_effort: reasoning.reasoning_effort } as Record<string, unknown>)
                : {}),
        } as OpenAI.ChatCompletionCreateParams;
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
