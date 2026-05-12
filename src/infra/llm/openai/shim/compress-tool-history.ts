// Rolls up the oldest complete (tool_use, tool_result) pairs in an LLM
// message history into a single system summary line per pair, keeping the
// most recent N pairs verbatim. Used by the OpenAI-shim family to prevent
// long tool-heavy conversations from blowing past context windows before
// the higher-level P02 compaction fires.
//
// Pairing logic mirrors P02 `microcompact`: a pair = one assistant message
// with `toolCalls[]` + one matching `tool` message per id. Incomplete pairs
// (missing any result) are never collapsed — they sit in the tail until the
// next round when the result arrives.

import type { LLMMessage } from '@xqoder/shared';

export interface CompressToolHistoryOptions {
    /** Number of most-recent pairs to keep verbatim. Default: 6. */
    readonly keepRecent?: number;
}

const DEFAULT_KEEP_RECENT = 6;

interface ToolPair {
    readonly assistantIndex: number;
    readonly resultIndexes: readonly number[];
    readonly toolNames: readonly string[];
    readonly resultMessages: readonly LLMMessage[];
}

export function compressToolHistory(
    messages: LLMMessage[],
    options: CompressToolHistoryOptions = {},
): LLMMessage[] {
    const keepRecent = Math.max(0, options.keepRecent ?? DEFAULT_KEEP_RECENT);
    const pairs = enumerateToolPairs(messages);
    if (pairs.length <= keepRecent) return messages;

    const toFold = pairs.slice(0, pairs.length - keepRecent);
    const removedIndexes = new Set<number>();
    const summaries: string[] = [];

    for (const pair of toFold) {
        removedIndexes.add(pair.assistantIndex);
        for (const idx of pair.resultIndexes) removedIndexes.add(idx);
        summaries.push(renderSummaryLine(pair));
    }

    const firstRemovedIndex = Math.min(...removedIndexes);
    const summaryMessage: LLMMessage = {
        role: 'system',
        content: summaries.join('\n'),
    };

    const out: LLMMessage[] = [];
    let inserted = false;
    for (let i = 0; i < messages.length; i++) {
        if (removedIndexes.has(i)) {
            if (!inserted && i === firstRemovedIndex) {
                out.push(summaryMessage);
                inserted = true;
            }
            continue;
        }
        out.push(messages[i]!);
    }
    if (!inserted) out.unshift(summaryMessage);
    return out;
}

function enumerateToolPairs(messages: LLMMessage[]): ToolPair[] {
    const pairs: ToolPair[] = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!;
        if (msg.role !== 'assistant' || !msg.toolCalls || msg.toolCalls.length === 0) continue;

        const neededIds = new Set(msg.toolCalls.map((c) => c.id));
        const resultIndexes: number[] = [];
        const resultMessages: LLMMessage[] = [];
        const toolNames = msg.toolCalls.map((c) => c.name);

        for (let j = i + 1; j < messages.length && neededIds.size > 0; j++) {
            const cand = messages[j]!;
            if (cand.role !== 'tool' || !cand.toolCallId) continue;
            if (neededIds.has(cand.toolCallId)) {
                resultIndexes.push(j);
                resultMessages.push(cand);
                neededIds.delete(cand.toolCallId);
            }
        }

        if (neededIds.size === 0) {
            pairs.push({
                assistantIndex: i,
                resultIndexes,
                toolNames,
                resultMessages,
            });
        }
    }
    return pairs;
}

function renderSummaryLine(pair: ToolPair): string {
    const name = pair.toolNames[0] ?? 'tool';
    const bytes = pair.resultMessages.reduce(
        (acc, m) => acc + Buffer.byteLength(m.content ?? '', 'utf8'),
        0,
    );
    const status = inferSuccess(pair.resultMessages) ? 'ok' : 'fail';
    return `[compressed ${name} → ${status} ${Math.round(bytes / 1024)}KB]`;
}

function inferSuccess(results: readonly LLMMessage[]): boolean {
    for (const r of results) {
        if (r.parts) {
            for (const part of r.parts) {
                if (part.type === 'tool_result' && part.success === false) return false;
            }
        }
        const head = (r.content ?? '').trimStart().slice(0, 64).toLowerCase();
        if (head.startsWith('error:') || head.startsWith('[error]')) return false;
    }
    return true;
}
