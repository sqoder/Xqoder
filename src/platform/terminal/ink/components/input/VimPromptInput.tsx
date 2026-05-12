// P06 follow-up — VimPromptInput: PromptInput with vim modal editing.
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { createVimState, processNormalKey, processInsertKey } from '../../vim/index.js';
import type { VimState } from '../../vim/index.js';

export interface VimPromptInputProps {
    onSubmit: (value: string) => void;
    onHistoryUp?: (current: string) => string | null;
    onHistoryDown?: () => string | null;
    onCtrlR?: () => void;
    placeholder?: string;
    focus?: boolean;
    prefix?: string;
}

export function VimPromptInput({
    onSubmit,
    onHistoryUp,
    onHistoryDown,
    onCtrlR,
    placeholder = 'Type a message…',
    focus = true,
    prefix = '> ',
}: VimPromptInputProps): React.ReactElement {
    const [value, setValue] = useState('');
    const [vimState, setVimState] = useState<VimState>(() => createVimState(false));

    useInput((input, key) => {
        if (!focus) return;

        // Ctrl+R → history search
        if (key.ctrl && input === 'r') {
            onCtrlR?.();
            return;
        }

        // Up/down arrow → history navigation
        if (key.upArrow) {
            const prev = onHistoryUp?.(value);
            if (prev !== null && prev !== undefined) setValue(prev);
            return;
        }
        if (key.downArrow) {
            const next = onHistoryDown?.();
            if (next !== null && next !== undefined) setValue(next);
            return;
        }

        // Ctrl+C → clear input
        if (key.ctrl && input === 'c') {
            setValue('');
            setVimState((s) => ({ ...s, cursor: 0 }));
            return;
        }

        if (vimState.enabled && vimState.mode === 'normal') {
            const result = processNormalKey(input || (key.escape ? 'escape' : ''), value, vimState);
            setValue(result.text);
            setVimState(result.state);
            if (result.submit && result.text.trim()) {
                onSubmit(result.text);
                setValue('');
                setVimState(createVimState(true));
            }
        } else {
            // Insert mode (or vim disabled)
            const keyName = key.escape ? 'escape'
                : key.return ? 'return'
                : key.backspace || key.delete ? 'backspace'
                : '';

            if (keyName) {
                const result = processInsertKey(keyName, '', value, { ...vimState, cursor: value.length });
                setValue(result.text);
                if (vimState.enabled) setVimState(result.state);
                if (result.submit && result.text.trim()) {
                    onSubmit(result.text);
                    setValue('');
                    setVimState(vimState.enabled ? createVimState(true) : vimState);
                }
            } else if (!key.ctrl && !key.meta && input) {
                setValue((v) => v + input);
            }
        }
    }, { isActive: focus });

    const modeIndicator = vimState.enabled
        ? (vimState.mode === 'normal' ? ' [N]' : ' [I]')
        : '';

    const showPlaceholder = value.length === 0 && !focus;

    return (
        <Box>
            <Text bold color="cyan">{prefix}</Text>
            {showPlaceholder ? (
                <Text dimColor>{placeholder}</Text>
            ) : (
                <Text>{value}</Text>
            )}
            {focus && <Text inverse>{' '}</Text>}
            {modeIndicator && <Text dimColor>{modeIndicator}</Text>}
        </Box>
    );
}
