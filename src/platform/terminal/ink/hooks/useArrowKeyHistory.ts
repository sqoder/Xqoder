// P22c — useArrowKeyHistory: navigate input history with up/down arrows.
import { useState, useCallback } from 'react';

export interface UseArrowKeyHistoryResult {
    historyIndex: number;
    navigateUp: (currentValue: string) => string | null;
    navigateDown: () => string | null;
    reset: () => void;
    savedDraft: string;
}

export function useArrowKeyHistory(history: string[]): UseArrowKeyHistoryResult {
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [savedDraft, setSavedDraft] = useState('');

    const navigateUp = useCallback((currentValue: string): string | null => {
        if (history.length === 0) return null;
        if (historyIndex === -1) setSavedDraft(currentValue);
        const next = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(next);
        return history[history.length - 1 - next] ?? null;
    }, [history, historyIndex]);

    const navigateDown = useCallback((): string | null => {
        if (historyIndex <= 0) {
            setHistoryIndex(-1);
            return savedDraft;
        }
        const next = historyIndex - 1;
        setHistoryIndex(next);
        return history[history.length - 1 - next] ?? null;
    }, [history, historyIndex, savedDraft]);

    const reset = useCallback(() => {
        setHistoryIndex(-1);
        setSavedDraft('');
    }, []);

    return { historyIndex, navigateUp, navigateDown, reset, savedDraft };
}
