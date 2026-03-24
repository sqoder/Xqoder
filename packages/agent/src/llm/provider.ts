// Re-export LLM API from local base-provider for backward compatibility.
export type {
  CompletionRequest,
  CompletionResponse,
  ILLMProvider,
} from './base-provider.js';
export { BaseLLMProvider } from './base-provider.js';
