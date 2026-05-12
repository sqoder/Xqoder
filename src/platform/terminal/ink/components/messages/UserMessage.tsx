// P22a — UserMessage: renders a user turn with a bordered box.
import React from 'react';
import { Box, Text } from 'ink';
import { MessageTimestamp } from './MessageTimestamp.js';

export interface UserMessageProps {
    content: string;
    timestamp?: Date;
}

export function UserMessage({ content, timestamp }: UserMessageProps): React.ReactElement {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                <Text bold color="cyan">You</Text>
                <Text> </Text>
                <MessageTimestamp date={timestamp} />
            </Box>
            <Box borderStyle="single" borderColor="cyan" paddingX={1}>
                <Text>{content}</Text>
            </Box>
        </Box>
    );
}
