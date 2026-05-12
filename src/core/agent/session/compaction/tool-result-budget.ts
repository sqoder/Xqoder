// P02 module 1: Byte-budget for oversize `role: 'tool'` messages.
// Pure function: truncates tool results above TOOL_RESULT_MAX_BYTES to head+tail
// with a `[truncated N bytes]` marker. Non-tool messages are untouched.

import type { LLMMessage } from '@xqoder/shared';

export const TOOL_RESULT_MAX_BYTES = 32 * 1024;
export const TOOL_RESULT_HEAD_BYTES = 8 * 1024;
export const TOOL_RESULT_TAIL_BYTES = 4 * 1024;

export interface ToolResultTruncation {
    toolCallId: string;
    originalBytes: number;
    keptBytes: number;
}

export interface ApplyToolResultBudgetOutput {
    messages: LLMMessage[];
    truncated: ToolResultTruncation[];
}

export function applyToolResultBudget(
    messages: LLMMessage[],
): ApplyToolResultBudgetOutput {
    const truncated: ToolResultTruncation[] = [];
    const next = messages.map((msg) => {
        if (msg.role !== 'tool' || typeof msg.content !== 'string') {
            return msg;
        }
        const bytes = Buffer.byteLength(msg.content, 'utf8');
        if (bytes <= TOOL_RESULT_MAX_BYTES) {
            return msg;
        }

        const head = msg.content.slice(0, TOOL_RESULT_HEAD_BYTES);
        const tail = msg.content.slice(-TOOL_RESULT_TAIL_BYTES);
        const droppedBytes = bytes - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8');
        const payload = `${head}\n…[truncated ${droppedBytes} bytes]…\n${tail}`;

        truncated.push({
            toolCallId: msg.toolCallId ?? 'unknown',
            originalBytes: bytes,
            keptBytes: Buffer.byteLength(payload, 'utf8'),
        });
        return { ...msg, content: payload };
    });
    return { messages: next, truncated };
}
