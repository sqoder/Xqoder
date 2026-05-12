// P22b — StructuredDiff: renders a structured diff with add/remove counts.
import React from 'react';
import { Box, Text } from 'ink';
import { FileDiff, parseDiffLines } from './FileDiff.js';

export interface StructuredDiffFile {
    path: string;
    diff: string;
    additions: number;
    deletions: number;
}

export interface StructuredDiffProps {
    files: StructuredDiffFile[];
}

export function StructuredDiff({ files }: StructuredDiffProps): React.ReactElement {
    const totalAdd = files.reduce((s, f) => s + f.additions, 0);
    const totalDel = files.reduce((s, f) => s + f.deletions, 0);

    return (
        <Box flexDirection="column">
            <Box marginBottom={1}>
                <Text bold>Changed {files.length} file{files.length !== 1 ? 's' : ''}: </Text>
                <Text color="green">+{totalAdd}</Text>
                <Text> </Text>
                <Text color="red">-{totalDel}</Text>
            </Box>
            {files.map((file) => (
                <FileDiff
                    key={file.path}
                    filePath={file.path}
                    lines={parseDiffLines(file.diff)}
                />
            ))}
        </Box>
    );
}
