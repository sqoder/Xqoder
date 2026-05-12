// P06 follow-up — InkApp with keybindings, history persistence, vim input.
import React, { useCallback, useState } from 'react';
import { Box, useApp } from 'ink';
import type { AgentConversationPort, TuiAgentSettings } from '../../../application/agent/ports.js';
import { MessageList } from './components/messages/index.js';
import { StatusBar, Spinner } from './components/chrome/index.js';
import { VimPromptInput } from './components/input/index.js';
import { ApprovalDialog } from './components/ApprovalDialog.js';
import { HistorySearchDialog } from './components/HistorySearchDialog.js';
import { useConversationStream } from './hooks/useConversationStream.js';
import { useVirtualScroll, useHistoryPersistence } from './hooks/index.js';
import { useArrowKeyHistory } from './hooks/index.js';
import { KeybindingProvider } from './keybindings/index.js';

export interface InkAppProps {
    agentService: AgentConversationPort;
    settings: TuiAgentSettings;
    initialSessionId?: string;
}

function InkAppInner({ agentService, settings, initialSessionId }: InkAppProps): React.ReactElement {
    const { exit } = useApp();
    const [showHistorySearch, setShowHistorySearch] = useState(false);

    const { history, addEntry } = useHistoryPersistence();

    const {
        messages,
        thinking,
        promptTokens,
        completionTokens,
        cost,
        sessionId,
        pendingApproval,
        pendingQuestion,
        isBusy,
        error,
        submit,
        cancel,
        resolveApproval,
        resolveQuestion,
    } = useConversationStream({ agentService, settings, initialSessionId });

    const { visibleRange } = useVirtualScroll({
        totalItems: messages.length,
        viewportSize: 30,
    });

    const visibleMessages = messages.slice(visibleRange.start, visibleRange.end);

    const { navigateUp, navigateDown } = useArrowKeyHistory(history);

    const handleSubmit = useCallback((text: string) => {
        const trimmed = text.trim();
        if (trimmed === '/exit' || trimmed === '/quit') {
            exit();
            return;
        }
        if (trimmed === '/cancel') {
            cancel();
            return;
        }
        addEntry(trimmed);
        submit(trimmed);
    }, [submit, cancel, exit, addEntry]);

    const handleHistoryUp = useCallback((current: string) => navigateUp(current), [navigateUp]);
    const handleHistoryDown = useCallback(() => navigateDown(), [navigateDown]);

    const handleQuestionSelect = useCallback((selected: string) => {
        if (!pendingQuestion) return;
        resolveQuestion({ requestId: pendingQuestion.request.requestId, selected: [selected] });
    }, [pendingQuestion, resolveQuestion]);

    const handleQuestionCancel = useCallback(() => {
        if (!pendingQuestion) return;
        resolveQuestion({ requestId: pendingQuestion.request.requestId, selected: [] });
    }, [pendingQuestion, resolveQuestion]);

    const handleHistorySearchSelect = useCallback((text: string) => {
        setShowHistorySearch(false);
        handleSubmit(text);
    }, [handleSubmit]);

    const isDialogOpen = !!pendingApproval || !!pendingQuestion || showHistorySearch;

    return (
        <Box flexDirection="column" height="100%">
            {/* Message area */}
            <Box flexGrow={1} flexDirection="column" overflow="hidden">
                <MessageList messages={visibleMessages} />
                {error && (
                    <Box paddingX={1}>
                        <Spinner label={`Error: ${error}`} />
                    </Box>
                )}
                {thinking && !isDialogOpen && (
                    <Spinner label="Thinking…" />
                )}
            </Box>

            {/* Approval dialog */}
            {pendingApproval && (
                <ApprovalDialog
                    request={pendingApproval.request}
                    onResolve={resolveApproval}
                />
            )}

            {/* Question dialog */}
            {pendingQuestion && (
                <HistorySearchDialog
                    items={pendingQuestion.request.options.map((o) => o.label)}
                    onSelect={handleQuestionSelect}
                    onCancel={handleQuestionCancel}
                />
            )}

            {/* Ctrl+R history search */}
            {showHistorySearch && (
                <HistorySearchDialog
                    items={history}
                    onSelect={handleHistorySearchSelect}
                    onCancel={() => setShowHistorySearch(false)}
                />
            )}

            {/* Status bar */}
            <StatusBar
                model={settings.model}
                promptTokens={promptTokens}
                completionTokens={completionTokens}
                cost={cost}
                mode={settings.agent}
                sessionId={sessionId}
            />

            {/* Prompt input */}
            {!isDialogOpen && (
                <VimPromptInput
                    onSubmit={handleSubmit}
                    onHistoryUp={handleHistoryUp}
                    onHistoryDown={handleHistoryDown}
                    onCtrlR={() => setShowHistorySearch(true)}
                    focus={!isBusy}
                    placeholder={isBusy ? 'Waiting… (/cancel to abort)' : 'Type a message…'}
                />
            )}
        </Box>
    );
}

export function InkApp(props: InkAppProps): React.ReactElement {
    return (
        <KeybindingProvider>
            <InkAppInner {...props} />
        </KeybindingProvider>
    );
}

