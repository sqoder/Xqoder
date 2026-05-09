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
  LLMProviderCapabilities,
} from '@xqoder/shared';
import { LLMError, resolveLLMProviderCapabilities } from '@xqoder/shared';
import { BaseLLMProvider, type CompletionRequest, type CompletionResponse } from '@xqoder/llm-api';
import { resolveProxyForProvider, type ProxyResolutionOptions } from '../../../../shared/network-proxy.js';
// Clean-room retry wrapper inspired by Claude Code / OpenClaude behavior.
// Handles 429 / 529 / 401-OAuth / transient socket errors uniformly so the
// application layer sees only classified LLM errors.
import { withRetry, wrapStream, isClassifiedLLMError } from '../../retry/index.js';

const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 120_000;

type OpenAIClientOptions = NonNullable<ConstructorParameters<typeof OpenAI>[0]> & {
  fetchOptions?: Record<string, unknown>;
};

interface OpenAIProviderDependencies {
  client?: Pick<OpenAI, 'chat'>;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  systemProxyReader?: ProxyResolutionOptions['systemProxyReader'];
}

function buildFileAttachmentContext(
  attachments: MessageAttachment[] | undefined,
  options: { capabilities: LLMProviderCapabilities },
): string {
  const fileAttachments = (attachments ?? []).filter((a) => a.type === 'file');
  const unsupported = collectUnsupportedNativeAttachments(attachments, options.capabilities);
  const blocks: string[] = [];
  if (fileAttachments.length > 0) {
    const lines = fileAttachments.map((a) => `- ${a.filePath ?? a.fileName ?? 'file'}${a.mimeType ? ` (${a.mimeType})` : ''}`);
    blocks.push(`[AttachedFiles]\nThe user attached these files to this request:\n${lines.join('\n')}\nTreat them as part of the request context and read them directly when needed.\n[/AttachedFiles]`);
  }
  if (unsupported.length > 0) {
    blocks.push([
      '[UnsupportedNativeAttachments]',
      `Provider ${options.capabilities.provider}/${options.capabilities.model} cannot receive these attachments as native content parts:`,
      ...unsupported.map((attachment) => `- ${attachment}`),
      'Use extracted text, rendered/OCR page images, or a provider/model with the matching modality enabled.',
      'Do not infer file contents from file names or paths alone.',
      '[/UnsupportedNativeAttachments]',
    ].join('\n'));
  }
  return blocks.join('\n\n');
}

function buildOpenAIContentParts(
  text: string,
  attachments: MessageAttachment[] | undefined,
  options: { capabilities: LLMProviderCapabilities },
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  const fileContext = buildFileAttachmentContext(attachments, options);
  const textContent = [text, fileContext].filter(Boolean).join('\n\n');
  if (textContent) content.push({ type: 'text', text: textContent });
  for (const attachment of attachments ?? []) {
    const imagePart = buildOpenAIImagePart(attachment, options.capabilities);
    if (imagePart) {
      content.push(imagePart);
      continue;
    }
    const filePart = buildOpenAIFilePart(attachment, options.capabilities);
    if (filePart) content.push(filePart);
  }
  return content;
}

function buildOpenAIImagePart(
  attachment: MessageAttachment,
  capabilities: LLMProviderCapabilities,
): Record<string, unknown> | undefined {
  if (attachment.type !== 'image' || !attachment.data || !capabilities.input.image) return undefined;
  return {
    type: 'image_url',
    image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` },
  };
}

function buildOpenAIFilePart(
  attachment: MessageAttachment,
  capabilities: LLMProviderCapabilities,
): Record<string, unknown> | undefined {
  if (
    attachment.type !== 'file'
    || !attachment.data
    || attachment.mimeType !== 'application/pdf'
    || !capabilities.nativePdf
  ) {
    return undefined;
  }
  const fileData = capabilities.openAIFileDataFormat === 'data-url'
    ? `data:${attachment.mimeType};base64,${attachment.data}`
    : attachment.data;
  return {
    type: 'file',
    file: {
      file_data: fileData,
      filename: attachment.fileName ?? attachment.filePath ?? 'attachment',
    },
  };
}

function buildToolAttachmentText(records: ToolAttachmentRecord[], options: { capabilities: LLMProviderCapabilities }): string {
  const lines = records.flatMap((record) =>
    record.attachments.map((attachment) => `- tool_call_id=${record.toolCallId}: ${attachment.fileName ?? attachment.filePath ?? attachment.mimeType}`)
  );
  const text = [
    '[ToolResultAttachments]',
    'The previous tool result produced model-readable attachments:',
    ...lines,
    'Use these attachments together with the tool result text. If a provider does not support a given file block, rely on the extracted text and warnings.',
    '[/ToolResultAttachments]',
  ];
  if (records.some((record) => collectUnsupportedNativeAttachments(record.attachments, options.capabilities).length > 0)) {
    text.push(
      '[UnsupportedToolResultAttachments]',
      `Provider ${options.capabilities.provider}/${options.capabilities.model} cannot receive at least one previous tool attachment as a native content part.`,
      'Unsupported native attachments from the previous tool result were not sent as media/file blocks.',
      'Use extracted text, rendered/OCR image attachments, or switch to a provider/model with the matching modality enabled before answering.',
      '[/UnsupportedToolResultAttachments]',
    );
  }
  return text.join('\n');
}

function collectUnsupportedNativeAttachments(
  attachments: MessageAttachment[] | undefined,
  capabilities: LLMProviderCapabilities,
): string[] {
  const unsupported: string[] = [];
  for (const attachment of attachments ?? []) {
    const label = attachment.fileName ?? attachment.filePath ?? attachment.mimeType ?? attachment.type;
    if (attachment.type === 'image' && attachment.data && !capabilities.input.image) {
      unsupported.push(`${label} (${attachment.mimeType || 'image'}; image modality disabled)`);
    }
    if (attachment.type === 'file' && attachment.data) {
      if (attachment.mimeType === 'application/pdf') {
        if (!capabilities.nativePdf) {
          unsupported.push(`${label} (application/pdf; PDF modality disabled or unavailable on this adapter)`);
        }
      } else {
        unsupported.push(`${label} (${attachment.mimeType || 'file'}; native file modality unsupported)`);
      }
    }
  }
  return unsupported;
}

interface ToolAttachmentRecord {
  toolCallId: string;
  attachments: MessageAttachment[];
}

/**
 * OpenAI Provider Implementation
 */
export class OpenAIProvider extends BaseLLMProvider {
  readonly name: LLMProviderName = 'openai';
  private readonly client: Pick<OpenAI, 'chat'>;
  private readonly timeoutMs: number;
  private readonly capabilities: LLMProviderCapabilities;

  constructor(config: LLMProviderConfig, dependencies: OpenAIProviderDependencies = {}) {
    super(config);
    this.timeoutMs = dependencies.timeoutMs ?? DEFAULT_OPENAI_REQUEST_TIMEOUT_MS;
    this.capabilities = resolveLLMProviderCapabilities(config);
    this.client = dependencies.client ?? new OpenAI(buildOpenAIClientOptions(
      config,
      this.timeoutMs,
      dependencies,
    ));
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const response = await withRetry(
        { providerName: this.name, foreground: true },
        () =>
          withTimeout(
            this.client.chat.completions.create({
              model: this.model,
              messages: this.formatMessages(request.messages),
              tools: request.tools ? (this.formatTools(request.tools) as OpenAI.ChatCompletionTool[]) : undefined,
              max_tokens: request.maxTokens ?? this.maxTokens,
              temperature: request.temperature ?? this.temperature,
            }, { timeout: this.timeoutMs }),
            this.timeoutMs,
            `OpenAI request timed out after ${this.timeoutMs}ms`,
          ),
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
      // Classified retry errors already carry provider + statusCode; rethrow
      // as-is so downstream code can `switch` on `kind`. Unknown errors fall
      // back to the original wrapped LLMError for compatibility.
      if (isClassifiedLLMError(err)) {
        throw err;
      }
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
      streamRef = await withRetry(
        { providerName: this.name, foreground: true },
        () =>
          withTimeout(
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
          ),
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
      // wrapStream gives us idle-based detection (StreamIdleError after
      // DEFAULT_STREAM_IDLE_MS without a chunk) instead of a wall-clock
      // timeout that would kill a slow-but-active stream.
      return await this.collectStreamingResponse(
        wrapStream(streamRef, { providerName: this.name }),
        callbacks,
      );
    } catch (err) {
      await closeAsyncIterable(streamRef);
      const error = err instanceof Error ? err : new Error(String(err));
      try {
        callbacks.onError?.(error);
      } catch {
        /* noop */
      }
      if (isClassifiedLLMError(err)) {
        throw err;
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
    const formatted: OpenAI.ChatCompletionMessageParam[] = [];
    let pendingToolAttachments: ToolAttachmentRecord[] = [];

    const flushToolAttachments = (): void => {
      if (pendingToolAttachments.length === 0) return;
      const attachments = pendingToolAttachments.flatMap((record) => record.attachments);
      const content = buildOpenAIContentParts(
        buildToolAttachmentText(pendingToolAttachments, { capabilities: this.capabilities }),
        attachments,
        { capabilities: this.capabilities },
      );
      formatted.push({
        role: 'user',
        content: content as unknown as OpenAI.ChatCompletionUserMessageParam['content'],
      });
      pendingToolAttachments = [];
    };

    for (const msg of messages) {
      if (msg.role !== 'tool') {
        flushToolAttachments();
      }
      if (msg.role === 'tool') {
        formatted.push({ role: 'tool', content: msg.content, tool_call_id: msg.toolCallId ?? '' });
        if (msg.attachments?.length) {
          pendingToolAttachments.push({
            toolCallId: msg.toolCallId ?? '',
            attachments: msg.attachments,
          });
        }
        continue;
      }
      if (msg.role === 'assistant' && msg.toolCalls) {
        formatted.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });
        continue;
      }
      if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
        const content = buildOpenAIContentParts(msg.content, msg.attachments, {
          capabilities: this.capabilities,
        });
        formatted.push({
          role: 'user',
          content: content as unknown as OpenAI.ChatCompletionUserMessageParam['content'],
        });
        continue;
      }
      formatted.push({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      });
    }

    flushToolAttachments();
    return formatted;
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

  if (isDashScopeProvider(config)) {
    clientOptions.defaultHeaders = {
      ...clientOptions.defaultHeaders,
      'User-Agent': 'Xqoder/0.1',
      'X-DashScope-CacheControl': 'enable',
      'X-DashScope-UserAgent': 'Xqoder/0.1',
      'X-DashScope-AuthType': config.provider,
    };
  }

  return clientOptions as ConstructorParameters<typeof OpenAI>[0];
}

function isDashScopeProvider(config: LLMProviderConfig): boolean {
  return config.provider === 'dashscope' || /([\w-]+\.)?dashscope(-intl)?\.aliyuncs\.com/i.test(config.baseUrl ?? '');
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
