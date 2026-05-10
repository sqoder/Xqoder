// P02 module 3: Microcompact — fold oldest N complete tool_use↔tool_result
// pair groups into a single system summary. Multi-id assistant messages are
// atomic: fold only when every id in `toolCalls` has a matching tool_result.

import type { LLMMessage } from '@xqoder/shared';
import { findBaseSystemMessage } from '../session-compaction.js';

export const MICRO_PAIRS_THRESHOLD = 10;
export const MICRO_PAIRS_TO_FOLD = 5;
export const MICRO_KEEP_RECENT_PAIRS = 3;

interface PairGroup {
    assistantIndex: number;
    resultIndexes: number[];
    toolNames: string[];
}

export function microcompact(messages: LLMMessage[]): LLMMessage[] {
    const pairs = enumerateToolPairs(messages);
    if (pairs.length < MICRO_PAIRS_THRESHOLD) return messages;

    const eligibleCount = Math.max(0, pairs.length - MICRO_KEEP_RECENT_PAIRS);
    const foldCount = Math.min(MICRO_PAIRS_TO_FOLD, eligibleCount);
    if (foldCount === 0) return messages;

    const toFold = pairs.slice(0, foldCount);
    const removedIndexes = new Set<number>();
    for (const p of toFold) {
        removedIndexes.add(p.assistantIndex);
        for (const r of p.resultIndexes) removedIndexes.add(r);
    }

    const summaryLines = toFold.map((p) =>
        `- ${p.toolNames.join(', ') || 'tool'}: ${p.resultIndexes.length} result(s)`,
    );
    const summary: LLMMessage = {
        role: 'system',
        content: `[microcompact summary of ${foldCount} tool calls]\n${summaryLines.join('\n')}`,
    };

    const next: LLMMessage[] = [];
    let inserted = false;
    const baseSystem = findBaseSystemMessage(messages);
    for (let i = 0; i < messages.length; i++) {
        if (removedIndexes.has(i)) continue;
        const msg = messages[i]!;
        next.push(msg);
        // Insert summary right after the base system message (or at position 1
        // if no base system). This keeps base system at index 0 and folds the
        // narrative immediately after.
        if (!inserted) {
            const anchor = baseSystem ? msg === baseSystem : next.length === 1;
            if (anchor) {
                next.push(summary);
                inserted = true;
            }
        }
    }
    if (!inserted) next.unshift(summary);
    return next;
}

function enumerateToolPairs(messages: LLMMessage[]): PairGroup[] {
    const pairs: PairGroup[] = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!;
        if (msg.role !== 'assistant' || !msg.toolCalls || msg.toolCalls.length === 0) {
            continue;
        }
        const neededIds = new Set(msg.toolCalls.map((c) => c.id));
        const resultIndexes: number[] = [];
        const toolNames = msg.toolCalls.map((c) => c.name);
        for (let j = i + 1; j < messages.length && neededIds.size > 0; j++) {
            const cand = messages[j]!;
            if (cand.role !== 'tool' || !cand.toolCallId) continue;
            if (neededIds.has(cand.toolCallId)) {
                resultIndexes.push(j);
                neededIds.delete(cand.toolCallId);
            }
        }
        if (neededIds.size === 0) {
            pairs.push({ assistantIndex: i, resultIndexes, toolNames });
        }
    }
    return pairs;
}
