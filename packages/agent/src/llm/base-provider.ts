import type { LLMMessage, ToolDefinition, StreamCallbacks, LLMProviderConfig } from '@xqoder/shared';

/** LLM 补全请求参数 */
export interface CompletionRequest {
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

/** LLM 补全响应 */
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
 * LLM Provider 抽象接口
 * 所有 LLM 后端都必须实现此接口
 */
export interface ILLMProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest, callbacks: StreamCallbacks): Promise<CompletionResponse>;
}

/**
 * LLM Provider 基类
 */
export abstract class BaseLLMProvider implements ILLMProvider {
  abstract readonly name: string;
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly maxTokens: number;
  readonly temperature: number;

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
