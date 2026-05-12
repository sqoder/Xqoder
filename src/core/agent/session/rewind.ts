// P24c — Session rewind: branch a session at a given message index.
//
// Rewind always creates a **branch** session (parent_session_id = original)
// so the original session is never destroyed. The branch contains messages
// [0..messageIndex] from the original and is otherwise a fresh session.

import * as crypto from 'node:crypto';
import type { LLMMessage } from '@xqoder/shared';
import { AgentSession } from './session.js';
import type { AgentSessionStore, PersistedSessionSummary } from './store.js';

export interface RewindInput {
    /** ID of the session to rewind. */
    sessionId: string;
    /**
     * 0-based index of the last message to keep (inclusive).
     * Messages after this index are discarded in the branch.
     */
    messageIndex: number;
    /** Model to use for the branch session. */
    model: string;
    /** Optional title for the branch session. */
    title?: string;
    /** Optional cwd override; defaults to the original session's cwd. */
    cwd?: string;
}

export interface RewindResult {
    branchSession: PersistedSessionSummary;
    keptMessages: number;
    discardedMessages: number;
}

/**
 * Create a branch session from `sessionId` keeping messages [0..messageIndex].
 *
 * Fail-closed: if the session is not found, or messageIndex is out of range,
 * throws rather than silently creating an empty branch.
 */
export function rewindSession(
    store: AgentSessionStore,
    input: RewindInput,
): RewindResult {
    const original = store.getSession(input.sessionId);
    if (!original) {
        throw new Error(`Session not found: ${input.sessionId}`);
    }

    const snapshot = original.toSnapshot();
    const messages = snapshot.messages;

    if (input.messageIndex < 0 || input.messageIndex >= messages.length) {
        throw new Error(
            `messageIndex ${input.messageIndex} is out of range [0, ${messages.length - 1}]`,
        );
    }

    const keptMessages = messages.slice(0, input.messageIndex + 1) as LLMMessage[];
    const discardedMessages = messages.length - keptMessages.length;

    // Build a new session with the truncated message list
    const branchId = `session_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const branchTitle = input.title ?? `Rewind of ${snapshot.title ?? input.sessionId} (msg ${input.messageIndex + 1})`;

    const branchSession = new AgentSession({
        id: branchId,
        title: branchTitle,
        createdAt: new Date(),
        maxMessages: snapshot.maxMessages,
        messages: keptMessages,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        metadata: {
            // Carry over compaction summary so context is not lost
            compactSummary: snapshot.metadata.compactSummary,
            compactions: [],
            toolHistory: [],
            verificationHistory: [],
            checkpointHistory: [],
            approvalHistory: [],
            pendingApprovals: [],
            commandHistory: [],
            fileChanges: [],
            toolResultRendererEvents: [],
            toolResultTranscriptEntries: [],
            toolResultEventStoreRecords: [],
            conversationEvents: [],
            conversationEventEnvelopes: [],
        },
    });

    const originalSummary = store.getSessionSummary(input.sessionId);
    const cwd = input.cwd ?? originalSummary?.cwd ?? process.cwd();
    const projectRoot = originalSummary?.projectRoot ?? cwd;

    const saved = store.saveSession({
        session: branchSession,
        projectRoot,
        cwd,
        model: input.model,
        title: branchTitle,
        parentSessionId: input.sessionId,
    });

    return {
        branchSession: saved,
        keptMessages: keptMessages.length,
        discardedMessages,
    };
}
