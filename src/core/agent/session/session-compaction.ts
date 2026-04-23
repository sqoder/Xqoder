import type { LLMMessage } from '@xqoder/shared';

import { cloneMessage, cloneMessages } from './session-cloners.js';
import type {
    AgentCommandHistoryEntry,
    AgentFileChangeEntry,
    SessionCompactionResult,
} from './session-types.js';
import {
    AUTO_SUMMARY_PREFIX,
    MAX_SUMMARY_LENGTH,
    generateCompactionId,
    truncateText,
} from './session-utils.js';

export function createManualCompactionResult(options: {
    messages: LLMMessage[];
    summary: string;
    createdAt?: Date;
}): SessionCompactionResult {
    const { messages, summary } = options;
    const baseSystemMessage = findBaseSystemMessage(messages);
    const conversationMessages = messages.filter((message) => message !== baseSystemMessage);
    const keepRecentCount = Math.max(4, Math.floor(conversationMessages.length * 0.2));
    const recentMessages = conversationMessages.slice(-keepRecentCount);

    const nextMessages: LLMMessage[] = [];
    if (baseSystemMessage) {
        nextMessages.push(cloneMessage(baseSystemMessage));
    }
    nextMessages.push({
        role: 'system',
        content: `${AUTO_SUMMARY_PREFIX}\n${summary}`,
    });
    nextMessages.push(...cloneMessages(recentMessages));

    return {
        summary,
        messages: nextMessages,
        compaction: {
            id: generateCompactionId(),
            createdAt: options.createdAt ?? new Date(),
            messageCountBefore: messages.length,
            messageCountAfter: nextMessages.length,
            summary,
        },
    };
}

export function createAutoCompactionResult(options: {
    messages: LLMMessage[];
    maxMessages: number;
    compactSummary?: string;
    commandHistory: AgentCommandHistoryEntry[];
    fileChanges: AgentFileChangeEntry[];
    createdAt?: Date;
}): SessionCompactionResult | null {
    const {
        messages,
        maxMessages,
        compactSummary,
        commandHistory,
        fileChanges,
    } = options;

    if (messages.length <= maxMessages) {
        return null;
    }

    const baseSystemMessage = findBaseSystemMessage(messages);
    const conversationMessages = messages.filter((message) => {
        if (message.role !== 'system') {
            return true;
        }

        return !isAutoSummaryMessage(message) && message !== baseSystemMessage;
    });
    const includeSummaryMessage = maxMessages > (baseSystemMessage ? 1 : 0);
    const reservedSlots = (baseSystemMessage ? 1 : 0) + (includeSummaryMessage ? 1 : 0);
    const maxRecentCount = Math.max(1, maxMessages - reservedSlots);
    const keepRecentCount = Math.min(
        conversationMessages.length,
        Math.max(1, Math.floor(maxMessages / 2)),
        maxRecentCount,
    );
    const compactBoundary = Math.max(0, conversationMessages.length - keepRecentCount);
    const compactedMessages = conversationMessages.slice(0, compactBoundary);
    const recentMessages = conversationMessages.slice(compactBoundary);
    const summary = buildCompactSummary({
        compactedMessages,
        compactSummary,
        commandHistory,
        fileChanges,
    });
    const nextMessages: LLMMessage[] = [];

    if (baseSystemMessage) {
        nextMessages.push(cloneMessage(baseSystemMessage));
    }
    if (includeSummaryMessage) {
        nextMessages.push({
            role: 'system',
            content: formatAutoSummaryMessage(summary),
        });
    }
    nextMessages.push(...cloneMessages(recentMessages));

    return {
        summary,
        messages: nextMessages.slice(-maxMessages),
        compaction: {
            id: generateCompactionId(),
            createdAt: options.createdAt ?? new Date(),
            messageCountBefore: messages.length,
            messageCountAfter: nextMessages.length,
            summary,
        },
    };
}

export function findBaseSystemMessage(messages: LLMMessage[]): LLMMessage | undefined {
    return messages.find((message) => message.role === 'system' && !isAutoSummaryMessage(message));
}

function isAutoSummaryMessage(message: LLMMessage): boolean {
    return message.role === 'system' && message.content.startsWith(AUTO_SUMMARY_PREFIX);
}

function formatAutoSummaryMessage(summary: string): string {
    return `${AUTO_SUMMARY_PREFIX}
The following is an automatically compacted context summary. Please continue using these facts and progress in subsequent responses:
${summary}`;
}

function buildCompactSummary(options: {
    compactedMessages: LLMMessage[];
    compactSummary?: string;
    commandHistory: AgentCommandHistoryEntry[];
    fileChanges: AgentFileChangeEntry[];
}): string {
    const {
        compactedMessages,
        compactSummary,
        commandHistory,
        fileChanges,
    } = options;
    const sections: string[] = [];
    const priorSummary = compactSummary?.trim();

    if (priorSummary) {
        sections.push(`Previous summary: ${truncateText(priorSummary, 320)}`);
    }

    const userRequests = collectDistinctMessages(compactedMessages, 'user', 4);
    if (userRequests.length > 0) {
        sections.push(`User requests: ${userRequests.join('; ')}`);
    }

    const assistantConclusions = collectDistinctMessages(compactedMessages, 'assistant', 3);
    if (assistantConclusions.length > 0) {
        sections.push(`Conclusions provided: ${assistantConclusions.join('; ')}`);
    }

    const recentCommands = commandHistory.slice(-4).map((entry) => truncateText(entry.command, 120));
    if (recentCommands.length > 0) {
        sections.push(`Recent commands: ${recentCommands.join('; ')}`);
    }

    const changedFiles = fileChanges.slice(-6).map((entry) => truncateText(entry.path, 120));
    if (changedFiles.length > 0) {
        sections.push(`Recently changed files: ${changedFiles.join('; ')}`);
    }

    if (sections.length === 0) {
        sections.push('Previous conversation has been automatically compacted. Please continue working with the current project context.');
    }

    return truncateText(
        sections.map((section) => `- ${section}`).join('\n'),
        MAX_SUMMARY_LENGTH,
    );
}

function collectDistinctMessages(
    messages: LLMMessage[],
    role: LLMMessage['role'],
    limit: number,
): string[] {
    const values = messages
        .filter((message) => message.role === role)
        .map((message) => truncateText(message.content.trim(), 140))
        .filter(Boolean);

    return Array.from(new Set(values)).slice(-limit);
}
