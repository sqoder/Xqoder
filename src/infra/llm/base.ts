import type { LLMMessage, ToolDefinition, StreamCallbacks, LLMProviderConfig } from '@xqoder/shared';

/** LLM completion request parameters */
export interface CompletionRequest {
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

/** LLM completion response */
export interface CompletionResponse {
  message: LLMMessage;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

/**
 * LLM Provider Abstract Interface
 * All LLM backends must implement this interface.
 */
export interface ILLMProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest, callbacks: StreamCallbacks): Promise<CompletionResponse>;
}

/**
 * LLM Provider Base Class
 */
export abstract class BaseLLMProvider implements ILLMProvider {
  abstract readonly name: string;
  readonly model: string;
  protected readonly apiKey: string;
  protected readonly baseUrl?: string;
  protected readonly maxTokens: number;
  protected readonly temperature: number;

  constructor(config: LLMProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.maxTokens = config.maxTokens ?? 4096;
    this.temperature = config.temperature ?? 0.1;
  }

  abstract complete(request: CompletionRequest): Promise<CompletionResponse>;
  abstract stream(request: CompletionRequest, callbacks: StreamCallbacks): Promise<CompletionResponse>;
  protected abstract formatTools(tools: ToolDefinition[]): unknown[];
}
