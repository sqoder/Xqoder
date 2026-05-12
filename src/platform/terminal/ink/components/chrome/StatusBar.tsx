// P22a — StatusBar: bottom chrome showing model / tokens / cost / mode.
import React from 'react';
import { Box, Text } from 'ink';

export interface StatusBarProps {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    cost?: number;
    mode?: string;
    sessionId?: string;
}

export function StatusBar({ model, promptTokens, completionTokens, cost, mode, sessionId }: StatusBarProps): React.ReactElement {
    const parts: string[] = [];
    if (model) parts.push(model);
    if (mode && mode !== 'ask') parts.push(`[${mode}]`);
    if (promptTokens !== undefined || completionTokens !== undefined) {
        const p = promptTokens ?? 0;
        const c = completionTokens ?? 0;
        parts.push(`${p}↑ ${c}↓`);
    }
    if (cost !== undefined) parts.push(`$${cost.toFixed(4)}`);
    if (sessionId) parts.push(sessionId.slice(0, 12));

    return (
        <Box borderStyle="single" borderColor="gray" paddingX={1}>
            <Text dimColor>{parts.join('  ·  ')}</Text>
        </Box>
    );
}
