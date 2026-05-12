// P22b — PromptInput: multi-line prompt input with history navigation.
import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from './TextInput.js';

export interface PromptInputProps {
    onSubmit: (value: string) => void;
    placeholder?: string;
    history?: string[];
    focus?: boolean;
    prefix?: string;
}

export function PromptInput({ onSubmit, placeholder = 'Type a message…', history = [], focus = true, prefix = '> ' }: PromptInputProps): React.ReactElement {
    const [value, setValue] = useState('');
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [savedDraft, setSavedDraft] = useState('');

    useInput((_input, key) => {
        if (!focus) return;

        if (key.upArrow && history.length > 0) {
            if (historyIndex === -1) setSavedDraft(value);
            const next = Math.min(historyIndex + 1, history.length - 1);
            setHistoryIndex(next);
            setValue(history[history.length - 1 - next] ?? '');
            return;
        }

        if (key.downArrow) {
            if (historyIndex <= 0) {
                setHistoryIndex(-1);
                setValue(savedDraft);
            } else {
                const next = historyIndex - 1;
                setHistoryIndex(next);
                setValue(history[history.length - 1 - next] ?? '');
            }
            return;
        }
    }, { isActive: focus });

    const handleSubmit = useCallback((v: string) => {
        if (!v.trim()) return;
        onSubmit(v);
        setValue('');
        setHistoryIndex(-1);
        setSavedDraft('');
    }, [onSubmit]);

    return (
        <Box>
            <Text bold color="cyan">{prefix}</Text>
            <TextInput
                value={value}
                onChange={(v) => { setValue(v); setHistoryIndex(-1); }}
                onSubmit={handleSubmit}
                placeholder={placeholder}
                focus={focus}
            />
        </Box>
    );
}
