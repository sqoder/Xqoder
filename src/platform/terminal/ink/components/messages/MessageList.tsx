// P22a — MessageList: renders a list of conversation messages.
import React from 'react';
import { Box } from 'ink';
import { UserMessage } from './UserMessage.js';
import { AssistantMessage } from './AssistantMessage.js';

export interface MessageEntry {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    thinking?: string;
    timestamp?: Date;
    streaming?: boolean;
}

export interface MessageListProps {
    messages: MessageEntry[];
    /** Max messages to render (virtual scroll approximation). Default: 50. */
    limit?: number;
}

export function MessageList({ messages, limit = 50 }: MessageListProps): React.ReactElement {
    const visible = messages.slice(-limit);
    return (
        <Box flexDirection="column">
            {visible.map((msg) =>
                msg.role === 'user' ? (
                    <UserMessage key={msg.id} content={msg.content} timestamp={msg.timestamp} />
                ) : (
                    <AssistantMessage
                        key={msg.id}
                        content={msg.content}
                        thinking={msg.thinking}
                        timestamp={msg.timestamp}
                        streaming={msg.streaming}
                    />
                ),
            )}
        </Box>
    );
}
