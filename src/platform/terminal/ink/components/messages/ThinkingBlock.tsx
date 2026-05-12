// P22a — ThinkingBlock: collapsible thinking/reasoning display.
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ThinkingBlockProps {
    content: string;
    /** Whether the block starts expanded. Default: false (collapsed). */
    defaultExpanded?: boolean;
}

export function ThinkingBlock({ content, defaultExpanded = false }: ThinkingBlockProps): React.ReactElement {
    const [expanded, setExpanded] = useState(defaultExpanded);

    useInput((_input, key) => {
        if (key.tab) setExpanded((v) => !v);
    });

    const preview = content.slice(0, 80).replace(/\n/g, ' ');

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                <Text dimColor>{'💭 Thinking'}</Text>
                <Text dimColor>{expanded ? ' [Tab to collapse]' : ` — ${preview}${content.length > 80 ? '…' : ''} [Tab to expand]`}</Text>
            </Box>
            {expanded && (
                <Box borderStyle="round" borderColor="gray" paddingX={1}>
                    <Text dimColor>{content}</Text>
                </Box>
            )}
        </Box>
    );
}
