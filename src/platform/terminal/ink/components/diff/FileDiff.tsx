// P22b — FileDiff: renders a unified diff with green/red line coloring.
import React from 'react';
import { Box, Text } from 'ink';

export interface DiffLine {
    type: 'add' | 'remove' | 'context' | 'header';
    content: string;
    lineNumber?: number;
}

export interface FileDiffProps {
    filePath: string;
    lines: DiffLine[];
    /** Max lines to show before truncating. Default: 80. */
    maxLines?: number;
}

function parseDiffLines(raw: string): DiffLine[] {
    return raw.split('\n').map((line): DiffLine => {
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
            return { type: 'header', content: line };
        }
        if (line.startsWith('+')) return { type: 'add', content: line.slice(1) };
        if (line.startsWith('-')) return { type: 'remove', content: line.slice(1) };
        return { type: 'context', content: line.startsWith(' ') ? line.slice(1) : line };
    });
}

export function FileDiff({ filePath, lines, maxLines = 80 }: FileDiffProps): React.ReactElement {
    const visible = lines.slice(0, maxLines);
    const truncated = lines.length > maxLines;

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                <Text bold color="cyan">{filePath}</Text>
            </Box>
            <Box flexDirection="column" borderStyle="single" borderColor="gray">
                {visible.map((line, i) => {
                    if (line.type === 'add') {
                        return <Box key={i}><Text color="green">{'+ '}{line.content}</Text></Box>;
                    }
                    if (line.type === 'remove') {
                        return <Box key={i}><Text color="red">{'- '}{line.content}</Text></Box>;
                    }
                    if (line.type === 'header') {
                        return <Box key={i}><Text dimColor>{line.content}</Text></Box>;
                    }
                    return <Box key={i}><Text>{'  '}{line.content}</Text></Box>;
                })}
                {truncated && (
                    <Box><Text dimColor>{`  … ${lines.length - maxLines} more lines`}</Text></Box>
                )}
            </Box>
        </Box>
    );
}

export { parseDiffLines };
