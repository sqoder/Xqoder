// P22a — Spinner: animated loading indicator.
import React, { useEffect, useState } from 'react';
import { Text } from 'ink';

const FRAMES = ['◐', '◓', '◑', '◒'];

export interface SpinnerProps {
    label?: string;
    intervalMs?: number;
}

export function Spinner({ label = 'Thinking...', intervalMs = 120 }: SpinnerProps): React.ReactElement {
    const [frame, setFrame] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs]);

    return (
        <Text color="cyan">{FRAMES[frame]} {label}</Text>
    );
}
