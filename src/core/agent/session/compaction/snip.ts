// P02 module 2: Snip long histories to baseSystem + head(4) + boundary + tail(8).
// Pure function. Guarantees tool_use ↔ tool_result pairing by dropping any
// orphan tool_result in the tail whose matching tool_use was snipped out.

import type { LLMMessage } from '@xqoder/shared';
import { findBaseSystemMessage } from '../session-compaction.js';

export const SNIP_THRESHOLD_BYTES = 256 * 1024;
export const SNIP_HEAD_COUNT = 4;
export const SNIP_TAIL_COUNT = 8;

export interface SnipResult {
    messages: LLMMessage[];
    snipped: boolean;
}

export function snipCompactIfNeeded(messages: LLMMessage[]): SnipResult {
    const totalBytes = messages.reduce(
        (n, m) => n + Buffer.byteLength(typeof m.content === 'string' ? m.content : '', 'utf8'),
        0,
    );
    if (totalBytes <= SNIP_THRESHOLD_BYTES) {
        return { messages, snipped: false };
    }

    const baseSystem = findBaseSystemMessage(messages);
    const rest = baseSystem ? messages.filter((m) => m !== baseSystem) : messages;
    if (rest.length <= SNIP_HEAD_COUNT + SNIP_TAIL_COUNT) {
        return { messages, snipped: false };
    }

    const head = rest.slice(0, SNIP_HEAD_COUNT);
    const tail = rest.slice(-SNIP_TAIL_COUNT);
    const midOmitted = rest.length - head.length - tail.length;

    // Surviving tool_use ids come from baseSystem + head only (middle is gone).
    const survivingToolUseIds = collectToolUseIds(
        baseSystem ? [baseSystem, ...head] : head,
    );
    const tailFixed = dropOrphanToolResults(tail, survivingToolUseIds);

    const boundary: LLMMessage = {
        role: 'system',
        content: `[snipped ${midOmitted} messages (~${Math.round(totalBytes / 1024)} KB). Scroll buffer preserved in session history.]`,
    };

    const next: LLMMessage[] = [
        ...(baseSystem ? [baseSystem] : []),
        ...head,
        boundary,
        ...tailFixed,
    ];
    return { messages: next, snipped: true };
}

function collectToolUseIds(messages: LLMMessage[]): Set<string> {
    const ids = new Set<string>();
    for (const m of messages) {
        if (m.role === 'assistant' && m.toolCalls) {
            for (const c of m.toolCalls) ids.add(c.id);
        }
    }
    return ids;
}

function dropOrphanToolResults(
    tail: LLMMessage[],
    survivingToolUseIds: Set<string>,
): LLMMessage[] {
    // Extend surviving ids with any tool_use messages introduced within the tail,
    // so a tool_use→tool_result pair entirely inside the tail remains intact.
    const allIds = new Set(survivingToolUseIds);
    for (const m of tail) {
        if (m.role === 'assistant' && m.toolCalls) {
            for (const c of m.toolCalls) allIds.add(c.id);
        }
    }
    return tail.filter((m) => {
        if (m.role !== 'tool') return true;
        const id = m.toolCallId;
        if (!id) return false;
        return allIds.has(id);
    });
}
