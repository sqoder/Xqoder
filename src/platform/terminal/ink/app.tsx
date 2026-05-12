// P22c — top-level Ink app component wiring all P22 components together.
import React, { useState, useCallback } from 'react';
import { Box, useApp } from 'ink';
import { MessageList, type MessageEntry } from './components/messages/index.js';
import { StatusBar } from './components/chrome/index.js';
import { Spinner } from './components/chrome/index.js';
import { PromptInput } from './components/input/index.js';
import { useVirtualScroll } from './hooks/index.js';

export interface InkAppProps {
    model?: string;
    sessionId?: string;
    onSubmit: (text: string) => void;
    messages?: MessageEntry[];
    thinking?: boolean;
    promptTokens?: number;
    completionTokens?: number;
    cost?: number;
    mode?: string;
    history?: string[];
}

export function InkApp({
    model,
    sessionId,
    onSubmit,
    messages = [],
    thinking = false,
    promptTokens,
    completionTokens,
    cost,
    mode,
    history = [],
}: InkAppProps): React.ReactElement {
    const { exit } = useApp();
    const [_inputFocus] = useState(true);
    const inputFocus = _inputFocus;

    const { visibleRange } = useVirtualScroll({
        totalItems: messages.length,
        viewportSize: 20,
    });

    const visibleMessages = messages.slice(visibleRange.start, visibleRange.end);

    const handleSubmit = useCallback((text: string) => {
        const trimmed = text.trim();
        if (trimmed === '/exit' || trimmed === '/quit') {
            exit();
            return;
        }
        onSubmit(trimmed);
    }, [onSubmit, exit]);

    return (
        <Box flexDirection="column" height="100%">
            <Box flexGrow={1} flexDirection="column" overflow="hidden">
                <MessageList messages={visibleMessages} />
                {thinking && <Spinner label="Thinking…" />}
            </Box>
            <StatusBar
                model={model}
                promptTokens={promptTokens}
                completionTokens={completionTokens}
                cost={cost}
                mode={mode}
                sessionId={sessionId}
            />
            <PromptInput
                onSubmit={handleSubmit}
                history={history}
                focus={inputFocus && !thinking}
            />
        </Box>
    );
}
