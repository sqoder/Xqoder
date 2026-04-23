import type { LLMMessage, ToolCall } from '@xqoder/shared';
import type { CompletionResponse } from './base.js';

export type ConversationProviderUsage = CompletionResponse['usage'];
export type ConversationProviderFinishReason = CompletionResponse['finishReason'];

export type ConversationProviderEvent =
    | { type: 'message'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'tool'; toolCall: ToolCall }
    | { type: 'usage'; usage: ConversationProviderUsage }
    | { type: 'stop'; message: LLMMessage; finishReason: ConversationProviderFinishReason }
    | { type: 'error'; error: Error };

export interface ConversationProviderEventStream {
    events: AsyncIterable<ConversationProviderEvent>;
    completed: Promise<void>;
}
