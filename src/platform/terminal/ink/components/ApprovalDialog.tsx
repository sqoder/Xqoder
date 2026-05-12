// P06 — ApprovalDialog: keyboard-driven tool approval (y/n/a/d).
import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { ToolApprovalRequest } from '../../../../core/agent/tools/tool.js';

export interface ApprovalDialogProps {
    request: ToolApprovalRequest;
    onResolve: (approved: boolean) => void;
}

export function ApprovalDialog({ request, onResolve }: ApprovalDialogProps): React.ReactElement {
    useInput((input, key) => {
        if (input === 'y' || input === 'Y' || input === 'a' || input === 'A') {
            onResolve(true);
        } else if (input === 'n' || input === 'N' || input === 'd' || input === 'D' || key.escape) {
            onResolve(false);
        }
    });

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
            <Box>
                <Text bold color="yellow">⚠ Tool Approval Required</Text>
            </Box>
            <Box marginTop={1}>
                <Text bold>{request.toolName}</Text>
                <Text dimColor>{` — ${request.summary}`}</Text>
            </Box>
            {request.reason && (
                <Box>
                    <Text dimColor>{request.reason}</Text>
                </Box>
            )}
            <Box marginTop={1}>
                <Text color="green">y</Text>
                <Text dimColor>/</Text>
                <Text color="green">a</Text>
                <Text dimColor> allow  </Text>
                <Text color="red">n</Text>
                <Text dimColor>/</Text>
                <Text color="red">d</Text>
                <Text dimColor>/Esc deny</Text>
            </Box>
        </Box>
    );
}
