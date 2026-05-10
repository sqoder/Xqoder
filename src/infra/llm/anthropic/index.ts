// ============================================================
// Anthropic LLM Provider
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
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
// Clean-room retry wrapper inspired by Claude Code / OpenClaude behavior.
// Absorbs 429 / 529 / OAuth401 / socket hiccups before they reach the
// application layer, surfacing only classified LLM errors.
import { withRetry, createIdleWatchdog, isClassifiedLLMError } from '../retry/index.js';

function buildFileAttachmentContext(attachments: MessageAttachment[] | undefined): string {
  const fileAttachments = (attachments ?? []).filter((a) => a.type === 'file');
  if (fileAttachments.length === 0) return '';
  const lines = fileAttachments.map((a) => `- ${a.filePath ?? a.fileName ?? 'file'}`);
  return `[AttachedFiles]\nThe user attached these files to this request:\n${lines.join('\n')}\nTreat them as part of the request context and read them directly when needed.\n[/AttachedFiles]`;
}

type AnthropicAttachmentBlock = Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam;

function buildAnthropicAttachmentBlock(
  attachment: MessageAttachment,
  capabilities: LLMProviderCapabilities,
): AnthropicAttachmentBlock | undefined {
  if (attachment.type === 'image' && attachment.data && capabilities.input.image) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: attachment.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: attachment.data,
      },
    };
  }

  if (attachment.type === 'file' && attachment.data && attachment.mimeType === 'application/pdf' && capabilities.nativePdf) {
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: attachment.data,
      },
      title: attachment.fileName ?? attachment.filePath ?? 'attachment.pdf',
    };
  }

  return undefined;
}

function buildAnthropicAttachmentBlocks(
  attachments: MessageAttachment[] | undefined,
  capabilities: LLMProviderCapabilities,
): AnthropicAttachmentBlock[] {
  return (attachments ?? [])
    .map((attachment) => buildAnthropicAttachmentBlock(attachment, capabilities))
    .filter((block): block is AnthropicAttachmentBlock => block !== undefined);
}

// Prompt-cache kill switch. Set XQODER_DISABLE_PROMPT_CACHE=1 to restore the
// pre-P03 plain-string `system` payload and stop tagging tail blocks.
function isPromptCacheDisabled(): boolean {
  return process.env.XQODER_DISABLE_PROMPT_CACHE === '1';
}

// Anthropic caches request prefixes byte-for-byte up to each cache_control
// breakpoint. We place one at the end of the system prompt (so identity/tools
// stay hot across turns) and optionally one at the tail of the last user/tool
// message (so the turn that just closed can be reused as a prefix next turn).
// Cap: ≤2 breakpoints per request — more would splinter the prefix.
function buildSystemParamWithCacheBreakpoint(
  systemText: string | undefined,
): string | Anthropic.TextBlockParam[] | undefined {
  if (systemText === undefined || systemText.length === 0) {
    return undefined;
  }
  if (isPromptCacheDisabled()) {
    return systemText;
  }
  return [
    {
      type: 'text',
      text: systemText,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

// Tag the final content block of the final user/tool message with
// cache_control so the recently-sent turn becomes a cache prefix for the next
// call. Normalizes string content into a single text block before tagging.
function injectTailCacheBreakpoint(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  if (isPromptCacheDisabled() || messages.length === 0) {
    return messages;
  }
  const tailIndex = messages.length - 1;
  const tail = messages[tailIndex];
  if (tail.role !== 'user') {
    return messages;
  }

  const blocks: Anthropic.ContentBlockParam[] = typeof tail.content === 'string'
    ? [{ type: 'text', text: tail.content }]
    : [...tail.content];
  if (blocks.length === 0) {
    return messages;
  }

  const last = blocks[blocks.length - 1];
  // Anthropic's TextBlock / ToolResultBlock / ImageBlock / DocumentBlock all
  // accept cache_control; we set it without rewriting the block shape.
  blocks[blocks.length - 1] = {
    ...last,
    cache_control: { type: 'ephemeral' },
  } as Anthropic.ContentBlockParam;

  const next = [...messages];
  next[tailIndex] = { ...tail, content: blocks };
  return next;
}

// Anthropic reports input_tokens EXCLUSIVE of cache_read / cache_creation.
// Fold the cache buckets back into promptTokens so downstream consumers
// (calculateCost's regularInput = promptTokens - cacheRead, session usage
// totals, cost telemetry) see a single consistent "what the API billed for".
function buildUsageFromAnthropic(raw: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
} {
  const cacheReadTokens = raw.cache_read_input_tokens ?? 0;
  const cacheCreationTokens = raw.cache_creation_input_tokens ?? 0;
  const promptTokens = raw.input_tokens + cacheReadTokens + cacheCreationTokens;
  const completionTokens = raw.output_tokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cacheReadTokens,
    cacheCreationTokens,
  };
}

function buildAnthropicToolResultContent(
  text: string,
  attachments: MessageAttachment[] | undefined,
  capabilities: LLMProviderCapabilities,
): string | Anthropic.ToolResultBlockParam['content'] {
  const attachmentBlocks = buildAnthropicAttachmentBlocks(attachments, capabilities);
  if (attachmentBlocks.length === 0) {
    return text;
  }

  return [
    ...(text ? [{ type: 'text' as const, text }] : []),
    ...attachmentBlocks,
  ];
}

/**
 * Anthropic Provider Implementation
 */
export class AnthropicProvider extends BaseLLMProvider {
  readonly name: LLMProviderName = 'anthropic';
  private client: Anthropic;
  private readonly capabilities: LLMProviderCapabilities;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.capabilities = resolveLLMProviderCapabilities(config);
    this.client = new Anthropic({ apiKey: this.apiKey, baseURL: this.baseUrl });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const systemMessage = request.messages.find((m) => m.role === 'system');
      const otherMessages = request.messages.filter((m) => m.role !== 'system');
      const response = await withRetry(
        { providerName: 'anthropic', foreground: true },
        () =>
          this.client.messages.create({
            model: this.model,
            system: buildSystemParamWithCacheBreakpoint(systemMessage?.content),
            messages: injectTailCacheBreakpoint(this.formatMessages(otherMessages)),
            tools: request.tools ? (this.formatTools(request.tools) as Anthropic.Tool[]) : undefined,
            max_tokens: request.maxTokens ?? this.maxTokens,
            temperature: request.temperature ?? this.temperature,
          }),
      );
      const message = this.parseResponse(response);
      return {
        message,
        usage: buildUsageFromAnthropic(response.usage),
        finishReason: this.mapStopReason(response.stop_reason),
      };
    } catch (err) {
      if (isClassifiedLLMError(err)) {
        throw err;
      }
      throw new LLMError(
        `Anthropic API call failed: ${err instanceof Error ? err.message : String(err)}`,
        'anthropic',
        err instanceof Anthropic.APIError ? err.status : undefined,
      );
    }
  }

  async stream(request: CompletionRequest, callbacks: StreamCallbacks): Promise<CompletionResponse> {
    try {
      const systemMessage = request.messages.find((m) => m.role === 'system');
      const otherMessages = request.messages.filter((m) => m.role !== 'system');
      // withRetry only guards the handshake here. Once the SSE stream opens,
      // socket errors mid-flight surface directly — there's no idempotent way
      // to re-splice a partially-consumed stream at this layer.
      const stream = await withRetry(
        { providerName: 'anthropic', foreground: true },
        async () =>
          this.client.messages.stream({
            model: this.model,
            system: buildSystemParamWithCacheBreakpoint(systemMessage?.content),
            messages: injectTailCacheBreakpoint(this.formatMessages(otherMessages)),
            tools: request.tools ? (this.formatTools(request.tools) as Anthropic.Tool[]) : undefined,
            max_tokens: request.maxTokens ?? this.maxTokens,
            temperature: request.temperature ?? this.temperature,
          }),
      );
      let content = '';
      const toolCalls: ToolCall[] = [];
      // Anthropic's MessageStream is event-emitter based, not an AsyncIterable,
      // so wrapStream() (which races iterator.next()) does not apply here.
      // We attach a watchdog that resets on each text / contentBlock event and
      // race its waitForIdle() against finalMessage(). On idle, StreamIdleError
      // beats finalMessage() and we abort the SDK stream in the catch below.
      const watchdog = createIdleWatchdog({ providerName: 'anthropic' });
      stream.on('text', (text) => {
        watchdog.tick();
        content += text;
        callbacks.onToken?.(text);
      });
      stream.on('contentBlock', (block) => {
        watchdog.tick();
        if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          });
          callbacks.onToolCall?.({ id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
        }
      });
      let finalMessage: Anthropic.Message;
      try {
        finalMessage = await Promise.race([
          stream.finalMessage(),
          watchdog.waitForIdle(),
        ]);
      } catch (raceErr) {
        // If the watchdog won, abort the still-running SDK stream so we don't
        // leak the underlying HTTP connection after rethrowing StreamIdleError.
        if (isClassifiedLLMError(raceErr) && raceErr.kind === 'stream_idle') {
          try {
            stream.abort();
          } catch {
            /* best-effort; SDK may already be closed */
          }
        }
        throw raceErr;
      } finally {
        watchdog.stop();
      }
      const message: LLMMessage = {
        role: 'assistant',
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      callbacks.onComplete?.(message);
      return {
        message,
        usage: buildUsageFromAnthropic(finalMessage.usage),
        finishReason: this.mapStopReason(finalMessage.stop_reason),
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError?.(error);
      if (isClassifiedLLMError(err)) {
        throw err;
      }
      throw new LLMError(`Anthropic streaming call failed: ${error.message}`, 'anthropic');
    }
  }

  private formatMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
    return messages.map((msg): Anthropic.MessageParam => {
      if (msg.role === 'assistant' && msg.toolCalls) {
        const content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }> = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        for (const tc of msg.toolCalls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: JSON.parse(tc.arguments) });
        }
        return { role: 'assistant', content: content as Anthropic.MessageParam['content'] };
      }
      if (msg.role === 'tool') {
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.toolCallId ?? '',
            content: buildAnthropicToolResultContent(msg.content, msg.attachments, this.capabilities),
          }],
        };
      }
      if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
        const content: Anthropic.ContentBlockParam[] = [];
        const fileContext = buildFileAttachmentContext(msg.attachments);
        const textContent = [msg.content, fileContext].filter(Boolean).join('\n\n');
        if (textContent) content.push({ type: 'text', text: textContent } as Anthropic.TextBlockParam);
        content.push(...buildAnthropicAttachmentBlocks(msg.attachments, this.capabilities));
        return { role: 'user', content };
      }
      return { role: msg.role as 'user' | 'assistant', content: msg.content };
    });
  }

  protected formatTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: Object.fromEntries(tool.parameters.map((p) => [p.name, { type: p.type, description: p.description }])),
        required: tool.parameters.filter((p) => p.required).map((p) => p.name),
      },
    }));
  }

  private parseResponse(response: Anthropic.Message): LLMMessage {
    let content = '';
    const toolCalls: ToolCall[] = [];
    for (const block of response.content) {
      if (block.type === 'text') content += block.text;
      else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
      }
    }
    return {
      role: 'assistant',
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private mapStopReason(reason: string | null): 'stop' | 'tool_calls' | 'length' | 'error' {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'tool_use':
        return 'tool_calls';
      case 'max_tokens':
        return 'length';
      default:
        return 'stop';
    }
  }
}
