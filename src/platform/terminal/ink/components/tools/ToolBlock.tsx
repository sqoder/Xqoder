// P22b — ToolBlock: renders a tool call with args and output.
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ToolBlockProps {
    toolName: string;
    args?: Record<string, unknown>;
    output?: string;
    success?: boolean;
    /** Whether the tool is still running. */
    running?: boolean;
}

export function ToolBlock({ toolName, args, output, success, running = false }: ToolBlockProps): React.ReactElement {
    const [expanded, setExpanded] = useState(false);

    useInput((_input, key) => {
        if (key.tab) setExpanded((v) => !v);
    });

    const statusColor = running ? 'yellow' : success === false ? 'red' : 'green';
    const statusIcon = running ? '⟳' : success === false ? '✗' : '✓';
    const argsPreview = args ? JSON.stringify(args).slice(0, 60) : '';

    return (
        <Box flexDirection="column" marginBottom={0}>
            <Box>
                <Text color={statusColor}>{statusIcon} </Text>
                <Text bold>{toolName}</Text>
                {argsPreview && <Text dimColor>{` ${argsPreview}${argsPreview.length >= 60 ? '…' : ''}`}</Text>}
                {!running && <Text dimColor>{' [Tab to expand]'}</Text>}
            </Box>
            {expanded && output && (
                <Box borderStyle="round" borderColor="gray" paddingX={1} marginLeft={2}>
                    <Text>{output.slice(0, 500)}{output.length > 500 ? '\n…' : ''}</Text>
                </Box>
            )}
        </Box>
    );
}
