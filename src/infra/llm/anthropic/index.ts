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
import { withRetry, isClassifiedLLMError } from '../retry/index.js';

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
            system: systemMessage?.content,
            messages: this.formatMessages(otherMessages),
            tools: request.tools ? (this.formatTools(request.tools) as Anthropic.Tool[]) : undefined,
            max_tokens: request.maxTokens ?? this.maxTokens,
            temperature: request.temperature ?? this.temperature,
          }),
      );
      const message = this.parseResponse(response);
      return {
        message,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
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
            system: systemMessage?.content,
            messages: this.formatMessages(otherMessages),
            tools: request.tools ? (this.formatTools(request.tools) as Anthropic.Tool[]) : undefined,
            max_tokens: request.maxTokens ?? this.maxTokens,
            temperature: request.temperature ?? this.temperature,
          }),
      );
      let content = '';
      const toolCalls: ToolCall[] = [];
      stream.on('text', (text) => {
        content += text;
        callbacks.onToken?.(text);
      });
      stream.on('contentBlock', (block) => {
        if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          });
          callbacks.onToolCall?.({ id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
        }
      });
      const finalMessage = await stream.finalMessage();
      const message: LLMMessage = {
        role: 'assistant',
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      callbacks.onComplete?.(message);
      return {
        message,
        usage: {
          promptTokens: finalMessage.usage.input_tokens,
          completionTokens: finalMessage.usage.output_tokens,
          totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
        },
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
