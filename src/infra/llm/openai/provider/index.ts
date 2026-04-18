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
  private client: OpenAI;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseUrl });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: this.formatMessages(request.messages),
        tools: request.tools ? (this.formatTools(request.tools) as OpenAI.ChatCompletionTool[]) : undefined,
        max_tokens: request.maxTokens ?? this.maxTokens,
        temperature: request.temperature ?? this.temperature,
      });
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
        `OpenAI API call failed: ${err instanceof Error ? err.message : String(err)}`,
        'openai',
        err instanceof OpenAI.APIError ? err.status : undefined,
      );
    }
  }

  async stream(request: CompletionRequest, callbacks: StreamCallbacks): Promise<CompletionResponse> {
    let streamRef: AsyncIterable<OpenAI.ChatCompletionChunk> | undefined;
    try {
      streamRef = await this.client.chat.completions.create({
        model: this.model,
        messages: this.formatMessages(request.messages),
        tools: request.tools ? (this.formatTools(request.tools) as OpenAI.ChatCompletionTool[]) : undefined,
        max_tokens: request.maxTokens ?? this.maxTokens,
        temperature: request.temperature ?? this.temperature,
        stream: true,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError?.(error);
      throw new LLMError(
        `OpenAI stream connection failed: ${error.message}`,
        'openai',
        err instanceof OpenAI.APIError ? err.status : undefined,
      );
    }
    try {
      let content = '';
      const toolCalls: ToolCall[] = [];
      const toolCallBuffers: Map<number, { id: string; name: string; arguments: string }> = new Map();
      let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';
      for await (const chunk of streamRef) {
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
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      try {
        callbacks.onError?.(error);
      } catch {
        /* noop */
      }
      throw new LLMError(`OpenAI stream call failed: ${error.message}`, 'openai');
    }
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
