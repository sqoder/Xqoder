// P22c — usePasteHandler: detect and handle paste events in the terminal.
import { useRef } from 'react';
import { useInput } from 'ink';

export interface UsePasteHandlerOptions {
    onPaste: (text: string) => void;
    /** Minimum chars to consider a paste vs. fast typing. Default: 3. */
    minPasteLength?: number;
    focus?: boolean;
}

export function usePasteHandler({ onPaste, minPasteLength = 3, focus = true }: UsePasteHandlerOptions): void {
    const bufferRef = useRef('');
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useInput((input) => {
        if (!focus || !input) return;

        bufferRef.current += input;

        if (timerRef.current) clearTimeout(timerRef.current);

        timerRef.current = setTimeout(() => {
            const text = bufferRef.current;
            bufferRef.current = '';
            timerRef.current = null;

            if (text.length >= minPasteLength) {
                onPaste(text);
            }
        }, 50); // 50ms debounce — pastes arrive in one tick, typing is slower
    }, { isActive: focus });
}
