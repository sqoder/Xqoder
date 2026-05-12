// P22a — AssistantMessage: renders an assistant turn with optional thinking block.
import React from 'react';
import { Box, Text } from 'ink';
import { MessageTimestamp } from './MessageTimestamp.js';
import { ThinkingBlock } from './ThinkingBlock.js';

export interface AssistantMessageProps {
    content: string;
    thinking?: string;
    timestamp?: Date;
    /** Show a streaming cursor at the end. */
    streaming?: boolean;
}

export function AssistantMessage({ content, thinking, timestamp, streaming = false }: AssistantMessageProps): React.ReactElement {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                <Text bold color="green">XQoder</Text>
                <Text> </Text>
                <MessageTimestamp date={timestamp} />
            </Box>
            {thinking && <ThinkingBlock content={thinking} />}
            <Box paddingLeft={1}>
                <Text>{content}{streaming ? '▋' : ''}</Text>
            </Box>
        </Box>
    );
}
