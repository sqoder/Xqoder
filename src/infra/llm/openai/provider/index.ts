// ============================================================
// OpenAI LLM Provider
// ============================================================

import OpenAI from 'openai';
import type {
  LLMProviderConfig,
  LLMProviderName,
  ToolDefinition,
  StreamCallbacks,
  LLMMessage,
  ToolCall,
  MessageAttachment,
} from '@xqoder/shared';
import { LLMError } from '@xqoder/shared';
import { BaseLLMProvider, type CompletionRequest, type CompletionResponse } from '@xqoder/llm-api';
import { resolveProxyForProvider, type ProxyResolutionOptions } from '../../../../shared/network-proxy.js';

const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 30_000;

type OpenAIClientOptions = NonNullable<ConstructorParameters<typeof OpenAI>[0]> & {
  fetchOptions?: Record<string, unknown>;
};

interface OpenAIProviderDependencies {
  client?: Pick<OpenAI, 'chat'>;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  systemProxyReader?: ProxyResolutionOptions['systemProxyReader'];
}

function buildFileAttachmentContext(attachments: MessageAttachment[] | undefined): string {
  const fileAttachments = (attachments ?? []).filter((a) => a.type === 'file');
  if (fileAttachments.length === 0) return '';
  const lines = fileAttachments.map((a) => `- ${a.filePath ?? a.fileName ?? 'file'}`);
  return `[AttachedFiles]\nThe user attached these files to this request:\n${lines.join('\n')}\nTreat them as part of the request context and read them directly when needed.\n[/AttachedFiles]`;
}

function buildOpenAIImagePart(attachment: MessageAttachment): Record<string, unknown> | null {
  if (attachment.type !== 'image' || !attachment.data) return null;
  return {
    type: 'image_url',
    image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` },
  };
}

/**
 * OpenAI Provider Implementation
 */
export class OpenAIProvider extends BaseLLMProvider {
  readonly name: LLMProviderName = 'openai';
  private readonly client: Pick<OpenAI, 'chat'>;
  private readonly timeoutMs: number;

  constructor(config: LLMProviderConfig, dependencies: OpenAIProviderDependencies = {}) {
    super(config);
    this.timeoutMs = dependencies.timeoutMs ?? DEFAULT_OPENAI_REQUEST_TIMEOUT_MS;
    this.client = dependencies.client ?? new OpenAI(buildOpenAIClientOptions(
      config,
      this.timeoutMs,
      dependencies,
    ));
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const response = await withTimeout(
        this.client.chat.completions.create({
          model: this.model,
          messages: this.formatMessages(request.messages),
          tools: request.tools ? (this.formatTools(request.tools) as OpenAI.ChatCompletionTool[]) : undefined,
          max_tokens: request.maxTokens ?? this.maxTokens,
          temperature: request.temperature ?? this.temperature,
        }, { timeout: this.timeoutMs }),
        this.timeoutMs,
        `OpenAI request timed out after ${this.timeoutMs}ms`,
      );
      const choice = response.choices[0]!;
      const message = this.parseResponseMessage(choice);
      return {
        message,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        finishReason: this.mapFinishReason(choice.finish_reason),
      };
    } catch (err) {
      throw new LLMError(
        `${this.name} API call failed: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        err instanceof OpenAI.APIError ? err.status : undefined,
      );
    }
  }

  async stream(request: CompletionRequest, callbacks: StreamCallbacks): Promise<CompletionResponse> {
    let streamRef: AsyncIterable<OpenAI.ChatCompletionChunk> | undefined;
    try {
      streamRef = await withTimeout(
        this.client.chat.completions.create({
          model: this.model,
          messages: this.formatMessages(request.messages),
          tools: request.tools ? (this.formatTools(request.tools) as OpenAI.ChatCompletionTool[]) : undefined,
          max_tokens: request.maxTokens ?? this.maxTokens,
          temperature: request.temperature ?? this.temperature,
          stream: true,
          stream_options: {
            include_usage: true,
          },
        }, { timeout: this.timeoutMs }),
        this.timeoutMs,
        `OpenAI stream connection timed out after ${this.timeoutMs}ms`,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError?.(error);
      throw new LLMError(
        `${this.name} stream connection failed: ${error.message}`,
        this.name,
        err instanceof OpenAI.APIError ? err.status : undefined,
      );
    }
    try {
      return await withTimeout(
        this.collectStreamingResponse(streamRef, callbacks),
        this.timeoutMs,
        `OpenAI stream timed out after ${this.timeoutMs}ms`,
      );
    } catch (err) {
      await closeAsyncIterable(streamRef);
      const error = err instanceof Error ? err : new Error(String(err));
      try {
        callbacks.onError?.(error);
      } catch {
        /* noop */
      }
      throw new LLMError(`${this.name} stream call failed: ${error.message}`, this.name);
    }
  }

  private async collectStreamingResponse(
    streamRef: AsyncIterable<OpenAI.ChatCompletionChunk>,
    callbacks: StreamCallbacks,
  ): Promise<CompletionResponse> {
    let content = '';
    const toolCalls: ToolCall[] = [];
    const toolCallBuffers: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';
    let usage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    for await (const chunk of streamRef) {
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          totalTokens: chunk.usage.total_tokens ?? 0,
        };
      }

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        try {
          callbacks.onToken?.(delta.content);
        } catch {
          /* noop */
        }
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallBuffers.has(tc.index)) {
            toolCallBuffers.set(tc.index, { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' });
          }
          const buf = toolCallBuffers.get(tc.index)!;
          if (tc.id) buf.id = tc.id;
          if (tc.function?.name) buf.name = tc.function.name;
          if (tc.function?.arguments) buf.arguments += tc.function.arguments;
        }
      }
      if (chunk.choices[0]?.finish_reason) {
        finishReason = this.mapFinishReason(chunk.choices[0].finish_reason);
      }
    }

    for (const buf of toolCallBuffers.values()) {
      const toolCall: ToolCall = { id: buf.id, name: buf.name, arguments: buf.arguments };
      toolCalls.push(toolCall);
      try {
        callbacks.onToolCall?.(toolCall);
      } catch {
        /* noop */
      }
    }

    const message: LLMMessage = {
      role: 'assistant',
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    try {
      callbacks.onComplete?.(message);
    } catch {
      /* noop */
    }
    return {
      message,
      usage,
      finishReason,
    };
  }

  private formatMessages(messages: LLMMessage[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((msg): OpenAI.ChatCompletionMessageParam => {
      if (msg.role === 'tool') {
        return { role: 'tool', content: msg.content, tool_call_id: msg.toolCallId ?? '' };
      }
      if (msg.role === 'assistant' && msg.toolCalls) {
        return {
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
      }
      if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
        const content: Array<Record<string, unknown>> = [];
        const fileContext = buildFileAttachmentContext(msg.attachments);
        const textContent = [msg.content, fileContext].filter(Boolean).join('\n\n');
        if (textContent) content.push({ type: 'text', text: textContent });
        for (const attachment of msg.attachments) {
          const imagePart = buildOpenAIImagePart(attachment);
          if (imagePart) content.push(imagePart);
        }
        return {
          role: 'user',
          content: content as unknown as OpenAI.ChatCompletionUserMessageParam['content'],
        };
      }
      return {
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      };
    });
  }

  protected formatTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(tool.parameters.map((p) => [p.name, { type: p.type, description: p.description }])),
          required: tool.parameters.filter((p) => p.required).map((p) => p.name),
        },
      },
    }));
  }

  private parseResponseMessage(choice: OpenAI.ChatCompletion.Choice): LLMMessage {
    const msg = choice.message;
    const toolCalls = msg.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));
    return {
      role: 'assistant',
      content: msg.content ?? '',
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private mapFinishReason(reason: string | null): 'stop' | 'tool_calls' | 'length' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'tool_calls':
        return 'tool_calls';
      case 'length':
        return 'length';
      default:
        return 'stop';
    }
  }
}


export function buildOpenAIClientOptions(
  config: LLMProviderConfig,
  timeoutMs: number = DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
  options: Pick<OpenAIProviderDependencies, 'env' | 'systemProxyReader'> = {},
): ConstructorParameters<typeof OpenAI>[0] {
  const proxy = resolveProxyForProvider({
    provider: config.provider,
    baseUrl: config.baseUrl,
    env: options.env,
    systemProxyReader: options.systemProxyReader,
  });
  const clientOptions: OpenAIClientOptions = {
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: timeoutMs,
  };

  if (proxy.proxyUrl) {
    clientOptions.fetchOptions = {
      ...clientOptions.fetchOptions,
      proxy: proxy.proxyUrl,
    };
  }

  return clientOptions as ConstructorParameters<typeof OpenAI>[0];
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

async function closeAsyncIterable(streamRef: AsyncIterable<unknown> | undefined): Promise<void> {
  if (!streamRef) {
    return;
  }

  const iteratorFactory = (streamRef as AsyncIterable<unknown>)[Symbol.asyncIterator];
  if (typeof iteratorFactory !== 'function') {
    return;
  }

  const iterator = iteratorFactory.call(streamRef) as AsyncIterator<unknown>;
  if (typeof iterator.return !== 'function') {
    return;
  }

  try {
    await iterator.return();
  } catch {
    /* noop */
  }
}
