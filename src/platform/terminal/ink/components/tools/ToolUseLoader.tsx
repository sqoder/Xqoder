// P22b — ToolUseLoader: animated spinner while a tool is running.
import React from 'react';
import { Box } from 'ink';
import { Spinner } from '../chrome/Spinner.js';

export interface ToolUseLoaderProps {
    toolName: string;
    args?: Record<string, unknown>;
}

export function ToolUseLoader({ toolName, args }: ToolUseLoaderProps): React.ReactElement {
    const argsPreview = args ? JSON.stringify(args).slice(0, 50) : '';
    return (
        <Box>
            <Spinner label={`${toolName}${argsPreview ? ` ${argsPreview}` : ''}…`} />
        </Box>
    );
}
