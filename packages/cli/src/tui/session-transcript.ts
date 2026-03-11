import type { LLMMessage } from '@xqoder/shared';
import type { ChatMessage } from './message.js';

function toAttachmentPaths(message: LLMMessage): string[] | undefined {
    const attachmentPaths = (message.attachments ?? [])
        .map((attachment) => attachment.filePath)
        .filter((value): value is string => typeof value === 'string' && value.length > 0);

    return attachmentPaths.length > 0 ? attachmentPaths : undefined;
}

function buildAssistantContent(message: LLMMessage): string {
    if (message.content.trim().length > 0) {
        return message.content;
    }

    if (message.toolCalls && message.toolCalls.length > 0) {
        return message.toolCalls
            .map((toolCall) => `tool: ${toolCall.name}`)
            .join('\n');
    }

    return '';
}

export function restoreChatMessagesFromSession(messages: LLMMessage[]): ChatMessage[] {
    return messages.flatMap<ChatMessage>((message, index) => {
        if (message.role === 'system') {
            return [];
        }

        if (message.role === 'user') {
            return [{
                id: `restored-user-${index}`,
                type: 'user',
                content: message.content,
                ...(toAttachmentPaths(message) ? { attachments: toAttachmentPaths(message) } : {}),
            } satisfies ChatMessage];
        }

        if (message.role === 'assistant') {
            const content = buildAssistantContent(message);
            if (content.trim().length === 0) {
                return [];
            }

            return [{
                id: `restored-assistant-${index}`,
                type: 'assistant',
                content,
            } satisfies ChatMessage];
        }

        if (message.role === 'tool') {
            return [{
                id: `restored-tool-${index}`,
                type: 'tool',
                content: message.content,
                toolName: message.toolCallId ?? 'tool',
                toolSuccess: true,
            } satisfies ChatMessage];
        }

        return [];
    });
}
