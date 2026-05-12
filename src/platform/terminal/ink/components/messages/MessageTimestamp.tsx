// P22a — MessageTimestamp: renders a formatted timestamp.
import React from 'react';
import { Text } from 'ink';

export interface MessageTimestampProps {
    date?: Date;
    dimmed?: boolean;
}

export function MessageTimestamp({ date, dimmed = true }: MessageTimestampProps): React.ReactElement {
    const d = date ?? new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return (
        <Text dimColor={dimmed}>{`${hh}:${mm}:${ss}`}</Text>
    );
}
