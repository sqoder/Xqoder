// ============================================================
// LLM Providers Consolidation
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
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
import { LLMError, getMessageAttachmentKind } from '@xqoder/shared';
import { BaseLLMProvider, type CompletionRequest, type CompletionResponse } from '../base-provider.js';

function buildFileAttachmentContext(attachments: MessageAttachment[] | undefined): string {
  const fileAttachments = (attachments ?? []).filter((a) => getMessageAttachmentKind(a) === 'file');
  if (fileAttachments.length === 0) return '';
  const lines = fileAttachments.map((a) => `- ${a.filePath ?? a.fileName ?? 'file'}`);
  return `[AttachedFiles]\nThe user attached these files to this request:\n${lines.join('\n')}\nTreat them as part of the request context and read them directly when needed.\n[/AttachedFiles]`;
}

function buildAttachmentPromptText(message: LLMMessage): string {
  const fileContext = buildFileAttachmentContext(message.attachments);
  if (!fileContext) {
    return message.content;
  }
  return message.content.trim().length > 0
    ? `${message.content}\n\n${fileContext}`
    : fileContext;
}

function getImageAttachments(attachments: MessageAttachment[] | undefined): MessageAttachment[] {
  return (attachments ?? []).filter((attachment) => getMessageAttachmentKind(attachment) === 'image' && typeof attachment.data === 'string');
}

// ============================================================
// Anthropic Provider
// ============================================================

export class AnthropicProvider extends BaseLLMProvider {
  readonly name: LLMProviderName = 'anthropic';
  private client: Anthropic;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.client = new Anthropic({ apiKey: this.apiKey, baseURL: this.baseUrl });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const systemMessage = request.messages.find((m) => m.role === 'system');
      const otherMessages = request.messages.filter((m) => m.role !== 'system');
      const response = await this.client.messages.create({
        model: this.model,
        system: systemMessage?.content,
        messages: this.formatMessages(otherMessages),
        tools: request.tools ? (this.formatTools(request.tools) as Anthropic.Tool[]) : undefined,
        max_tokens: request.maxTokens ?? this.maxTokens,
        temperature: request.temperature ?? this.temperature,
      });
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
      throw new LLMError(
        `Anthropic API 调用失败: ${err instanceof Error ? err.message : String(err)}`,
        'anthropic',
        err instanceof Anthropic.APIError ? err.status : undefined,
      );
    }
  }

  async stream(request: CompletionRequest, callbacks: StreamCallbacks): Promise<CompletionResponse> {
    try {
      const systemMessage = request.messages.find((m) => m.role === 'system');
      const otherMessages = request.messages.filter((m) => m.role !== 'system');
      const stream = this.client.messages.stream({
        model: this.model,
        system: systemMessage?.content,
        messages: this.formatMessages(otherMessages),
        tools: request.tools ? (this.formatTools(request.tools) as Anthropic.Tool[]) : undefined,
        max_tokens: request.maxTokens ?? this.maxTokens,
        temperature: request.temperature ?? this.temperature,
      });
      let content = '';
      const toolCalls: ToolCall[] = [];
      stream.on('text', (text) => {
        content += text;
        callbacks.onToken?.(text);
      });
      stream.on('contentBlock', (block) => {
        if (block.type === 'tool_use') {
          toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
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
      throw new LLMError(`Anthropic 流式调用失败: ${error.message}`, 'anthropic');
    }
  }

  private formatMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
    return messages.map((msg): Anthropic.MessageParam => {
      if (msg.role === 'assistant' && msg.toolCalls) {
        const content: any[] = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        for (const tc of msg.toolCalls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: JSON.parse(tc.arguments) });
        }
        return { role: 'assistant', content: content as Anthropic.MessageParam['content'] };
      }
      if (msg.role === 'tool') {
        return {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: msg.toolCallId ?? '', content: msg.content }],
        };
      }
      if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
        const imageAttachments = getImageAttachments(msg.attachments);
        const content: Anthropic.MessageParam['content'] = [{
          type: 'text',
          text: buildAttachmentPromptText(msg),
        }];
        for (const attachment of imageAttachments) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: attachment.mimeType ?? 'image/png',
              data: attachment.data,
            },
          } as Anthropic.ImageBlockParam);
        }
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
    return { role: 'assistant', content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }

  private mapStopReason(reason: string | null): 'stop' | 'tool_calls' | 'length' | 'error' {
    switch (reason) {
      case 'end_turn': return 'stop';
      case 'tool_use': return 'tool_calls';
      case 'max_tokens': return 'length';
      default: return 'stop';
    }
  }
}

// ============================================================
// OpenAI Provider
// ============================================================

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
      throw new LLMError(`OpenAI API 调用失败: ${err instanceof Error ? err.message : String(err)}`, 'openai');
    }
  }

  async stream(request: CompletionRequest, callbacks: StreamCallbacks): Promise<CompletionResponse> {
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: this.formatMessages(request.messages),
        tools: request.tools ? (this.formatTools(request.tools) as OpenAI.ChatCompletionTool[]) : undefined,
        max_tokens: request.maxTokens ?? this.maxTokens,
        temperature: request.temperature ?? this.temperature,
        stream: true,
      });
      let content = '';
      const toolCallBuffers: Map<number, any> = new Map();
      let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          callbacks.onToken?.(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolCallBuffers.has(tc.index)) {
              toolCallBuffers.set(tc.index, { id: tc.id, name: tc.function?.name, arguments: '' });
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

      const toolCalls = Array.from(toolCallBuffers.values()).map(buf => ({
        id: buf.id,
        name: buf.name,
        arguments: buf.arguments
      }));

      for (const tc of toolCalls) {
        callbacks.onToolCall?.(tc);
      }

      const message: LLMMessage = { role: 'assistant', content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
      callbacks.onComplete?.(message);
      return { message, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError?.(error);
      throw new LLMError(`OpenAI 流式调用失败: ${error.message}`, 'openai');
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
        const imageAttachments = getImageAttachments(msg.attachments);
        const content: OpenAI.ChatCompletionContentPart[] = [{
          type: 'text',
          text: buildAttachmentPromptText(msg),
        }];
        for (const attachment of imageAttachments) {
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:${attachment.mimeType ?? 'image/png'};base64,${attachment.data}`,
            },
          } as OpenAI.ChatCompletionContentPart);
        }
        return { role: 'user', content };
      }
      return { role: msg.role as 'system' | 'user' | 'assistant', content: msg.content };
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
    const toolCalls = msg.tool_calls?.map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }));
    return { role: 'assistant', content: msg.content ?? '', toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined };
  }

  private mapFinishReason(reason: string | null): 'stop' | 'tool_calls' | 'length' | 'error' {
    switch (reason) {
      case 'stop': return 'stop';
      case 'tool_calls': return 'tool_calls';
      case 'length': return 'length';
      default: return 'stop';
    }
  }
}
