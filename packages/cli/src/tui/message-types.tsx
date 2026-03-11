import React from 'react';
import { Text } from 'ink';
import { formatAttachmentDisplayLabel } from './attachments.js';

export type MessageType = 'user' | 'assistant' | 'tool' | 'system';

export interface ChatMessage {
    id: string;
    type: MessageType;
    content: string;
    attachments?: string[];
    timestamp?: Date;
    toolName?: string;
    toolSuccess?: boolean;
    isStreaming?: boolean;
}

export interface MessageProps {
    message: ChatMessage;
    width: number;
    isFocused?: boolean;
}

export function Message({ message }: MessageProps): React.JSX.Element {
    const attachmentSuffix = message.attachments && message.attachments.length > 0
        ? ` ${message.attachments.map((attachment) => `[${formatAttachmentDisplayLabel(attachment)}]`).join(' ')}`
        : '';

    switch (message.type) {
        case 'user':
            return <Text>You {message.content}{attachmentSuffix}</Text>;
        case 'assistant':
            return <Text>Xqoder {message.content}</Text>;
        case 'tool':
            return (
                <Text>
                    tool: {message.toolName ?? 'tool'}
                    {' '}({message.toolSuccess === false ? 'failed' : 'ok'})
                </Text>
            );
        case 'system':
            return <Text>{message.content}</Text>;
        default:
            return <Text>{message.content}</Text>;
    }
}
