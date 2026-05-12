// Converts XQoder internal `LLMMessage[]` into OpenAI ChatCompletion
// messages. The mapping is deliberately narrower than the legacy provider:
// attachments/images are handled by the caller's capabilities layer when we
// plug this into the real provider. This module stays a pure text / tool
// translator so it's easy to unit test.

import type { LLMMessage, ToolCall } from '@xqoder/shared';

export type OpenAIChatMessage =
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCallMessage[] }
    | { role: 'tool'; content: string; tool_call_id: string };

export interface OpenAIToolCallMessage {
    readonly id: string;
    readonly type: 'function';
    readonly function: { readonly name: string; readonly arguments: string };
}

export function convertMessages(messages: LLMMessage[]): OpenAIChatMessage[] {
    const out: OpenAIChatMessage[] = [];
    for (const m of messages) {
        switch (m.role) {
            case 'system':
                out.push({ role: 'system', content: m.content });
                break;
            case 'user':
                out.push({ role: 'user', content: m.content });
                break;
            case 'assistant':
                out.push(convertAssistantMessage(m));
                break;
            case 'tool':
                out.push({
                    role: 'tool',
                    content: m.content,
                    tool_call_id: m.toolCallId ?? '',
                });
                break;
            default:
                throw new Error(`convertMessages: unsupported role ${String(m.role)}`);
        }
    }
    return out;
}

function convertAssistantMessage(m: LLMMessage): OpenAIChatMessage {
    if (m.toolCalls && m.toolCalls.length > 0) {
        return {
            role: 'assistant',
            content: m.content.length > 0 ? m.content : null,
            tool_calls: m.toolCalls.map(toolCallToOpenAI),
        };
    }
    return { role: 'assistant', content: m.content };
}

function toolCallToOpenAI(tc: ToolCall): OpenAIToolCallMessage {
    return {
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: safeStringifyArgs(tc.arguments) },
    };
}

function safeStringifyArgs(args: string): string {
    // XQoder's internal ToolCall already stores arguments as string, but
    // defensively stringify if a caller passed a raw object.
    if (typeof args === 'string') return args;
    try {
        return JSON.stringify(args);
    } catch {
        return '';
    }
}
