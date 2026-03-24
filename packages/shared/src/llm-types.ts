import type { LLMMessage } from './message-types.js';
import type { ToolCall } from './tool-types.js';

// ---- LLM Provider 相关类型 ----

/** LLM Provider 配置 */
export type LLMProviderName = 'openai' | 'anthropic' | 'dashscope' | 'gemini' | 'openai-compatible' | 'azure' | 'bedrock' | 'copilot' | 'vertexai' | 'groq' | 'openrouter' | 'local' | 'xai' | 'zhipu';

/** LLM Provider 配置 */
export interface LLMProviderConfig {
    provider: LLMProviderName;
    model: string;
    apiKey: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
}

/** LLM 流式回调 */
export interface StreamCallbacks {
    onToken?: (token: string) => void;
    onThinkingToken?: (token: string) => void;
    onToolCall?: (toolCall: ToolCall) => void;
    onComplete?: (message: LLMMessage) => void;
    onError?: (error: Error) => void;
}
