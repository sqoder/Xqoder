// P06 — Full InkApp wired to AgentConversationPort via useConversationStream.
import React, { useCallback } from 'react';
import { Box, useApp } from 'ink';
import type { AgentConversationPort, TuiAgentSettings } from '../../../application/agent/ports.js';
import { MessageList } from './components/messages/index.js';
import { StatusBar, Spinner } from './components/chrome/index.js';
import { PromptInput } from './components/input/index.js';
import { ApprovalDialog } from './components/ApprovalDialog.js';
import { HistorySearchDialog } from './components/HistorySearchDialog.js';
import { useConversationStream } from './hooks/useConversationStream.js';
import { useVirtualScroll } from './hooks/index.js';

export interface InkAppProps {
    agentService: AgentConversationPort;
    settings: TuiAgentSettings;
    initialSessionId?: string;
    /** Pre-populated history from restored session. */
    initialHistory?: string[];
}

export function InkApp({ agentService, settings, initialSessionId, initialHistory = [] }: InkAppProps): React.ReactElement {
    const { exit } = useApp();

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
        submit(trimmed);
    }, [submit, cancel, exit]);

    const handleQuestionSelect = useCallback((selected: string) => {
        if (!pendingQuestion) return;
        resolveQuestion({ requestId: pendingQuestion.request.requestId, selected: [selected] });
    }, [pendingQuestion, resolveQuestion]);

    const handleQuestionCancel = useCallback(() => {
        if (!pendingQuestion) return;
        resolveQuestion({ requestId: pendingQuestion.request.requestId, selected: [] });
    }, [pendingQuestion, resolveQuestion]);

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
                {thinking && !pendingApproval && !pendingQuestion && (
                    <Spinner label="Thinking…" />
                )}
            </Box>

            {/* Approval dialog (blocks input) */}
            {pendingApproval && (
                <ApprovalDialog
                    request={pendingApproval.request}
                    onResolve={resolveApproval}
                />
            )}

            {/* Question dialog (blocks input) */}
            {pendingQuestion && (
                <HistorySearchDialog
                    items={pendingQuestion.request.options.map((o) => o.label)}
                    onSelect={handleQuestionSelect}
                    onCancel={handleQuestionCancel}
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

            {/* Prompt input (disabled while dialog open) */}
            {!pendingApproval && !pendingQuestion && (
                <PromptInput
                    onSubmit={handleSubmit}
                    history={initialHistory}
                    focus={!isBusy}
                    placeholder={isBusy ? 'Waiting… (type /cancel to abort)' : 'Type a message…'}
                />
            )}
        </Box>
    );
}

