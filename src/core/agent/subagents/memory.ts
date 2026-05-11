// P16b — AgentMemory + snapshotSubagentMemory.
//
// A subagent runs as a forked session. When it finishes, the parent needs
// to know:
//   - which files the child read (to avoid re-reading them)
//   - any notes the child wrote for the parent's attention
//   - the child's final assistant message (the "answer")
//   - the child's token usage (for cost attribution)
//
// `AgentMemorySnapshot` is the data contract P16c will feed back into the
// AgentTool tool_result. This module is pure: no session, no provider, no
// side effects. The session-like surface it expects is declared as
// `ForkableSessionView` so P16c can satisfy it with the real `AgentSession`
// and tests can satisfy it with a stub.

import type { LLMMessage } from '@xqoder/shared';

/**
 * Minimal read-only surface of AgentSession needed to snapshot a child.
 *
 * The parent's session exposes these plus a lot more; by declaring only the
 * shape we need, tests can pass a simple object literal and future session
 * refactors do not ripple into P16b.
 */
export interface ForkableSessionView {
    getMessages(): readonly LLMMessage[];
    getUsage(): AgentMemoryUsage;
    /** Optional: list of file paths the agent has read. */
    getReadFiles?(): readonly string[];
    /** Optional: notes the child wrote. Shape is opaque to this layer. */
    getWrittenNotes?(): readonly AgentMemoryNote[];
}

export interface AgentMemoryUsage {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
    readonly cacheReadTokens?: number;
    readonly cacheCreationTokens?: number;
}

export interface AgentMemoryNote {
    readonly key: string;
    readonly body: string;
}

export interface AgentMemorySnapshot {
    /** Paths of files the child read. De-duplicated, preserves first-seen order. */
    readonly readFiles: readonly string[];
    /** Notes the child wrote for the parent. Empty when the child wrote none. */
    readonly writtenNotes: readonly AgentMemoryNote[];
    /** The child's last assistant message (trimmed content), if any. */
    readonly finalResponse?: string;
    /** The child's cumulative token usage. */
    readonly usage: AgentMemoryUsage;
}

export function snapshotSubagentMemory(child: ForkableSessionView): AgentMemorySnapshot {
    const readFiles = dedupePreserveOrder(child.getReadFiles?.() ?? []);
    const writtenNotes = [...(child.getWrittenNotes?.() ?? [])];
    const finalResponse = extractLastAssistantContent(child.getMessages());
    const usage = child.getUsage();
    return {
        readFiles,
        writtenNotes,
        ...(finalResponse !== undefined ? { finalResponse } : {}),
        usage,
    };
}

function extractLastAssistantContent(messages: readonly LLMMessage[]): string | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message && message.role === 'assistant') {
            const trimmed = message.content.trim();
            return trimmed.length > 0 ? trimmed : undefined;
        }
    }
    return undefined;
}

function dedupePreserveOrder(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        if (!seen.has(value)) {
            seen.add(value);
            result.push(value);
        }
    }
    return result;
}

/**
 * Renders the snapshot as the string body that the AgentTool returns to the
 * parent LLM as a tool_result. Kept in the pure layer so tests can lock in
 * the exact wire format and avoid divergence across call sites.
 */
export function renderAgentMemorySnapshot(snapshot: AgentMemorySnapshot): string {
    const sections: string[] = [];
    if (snapshot.finalResponse) {
        sections.push(snapshot.finalResponse);
    } else {
        sections.push('[subagent produced no final response]');
    }
    if (snapshot.readFiles.length > 0) {
        sections.push(`Files read: ${snapshot.readFiles.join(', ')}`);
    }
    if (snapshot.writtenNotes.length > 0) {
        const notes = snapshot.writtenNotes
            .map((note) => `- ${note.key}: ${note.body}`)
            .join('\n');
        sections.push(`Notes:\n${notes}`);
    }
    sections.push(
        `Usage: prompt=${snapshot.usage.promptTokens} completion=${snapshot.usage.completionTokens} total=${snapshot.usage.totalTokens}`,
    );
    return sections.join('\n\n');
}
