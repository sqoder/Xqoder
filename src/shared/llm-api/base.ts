import type {
  LLMMessage,
  ToolDefinition,
  StreamCallbacks,
  LLMProviderConfig,
} from '@xqoder/shared';

export interface CompletionRequest {
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface CompletionResponse {
  message: LLMMessage;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    // Anthropic prompt cache indicators. Non-Anthropic providers leave them
    // undefined; downstream calculateCost/recordUsage tolerate absence.
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface ILLMProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest, callbacks: StreamCallbacks): Promise<CompletionResponse>;
}

export abstract class BaseLLMProvider implements ILLMProvider {
  abstract readonly name: string;
  readonly model: string;
  protected readonly apiKey: string;
  protected readonly baseUrl: string | undefined;
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
