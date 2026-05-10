// Streaming filter that strips reasoning-tag blocks emitted by
// open-source reasoning models (DeepSeek-R1, QwQ, Qwen-QwQ, etc.) before
// the text is forwarded to callbacks.onToken.
//
// P08 upgrade over P05:
//   - Matches <think>, <thinking>, <scratchpad>, <reasoning>, <thought>.
//   - Optional `onThinking` callback forwards tag-internal text instead of
//     dropping it, so reasoning emitted via tags surfaces through the same
//     channel as native reasoning_content deltas in stream-parser.ts.
//
// Tail-buffer size stays at the longest tag (`</scratchpad>` = 13 chars),
// tightened from OpenClaude's 32-byte buffer because no supported tag is
// longer.

const OPEN_TAG = /<(think|thinking|scratchpad|reasoning|thought)>/i;
const CLOSE_TAG = /<\/(think|thinking|scratchpad|reasoning|thought)>/i;
const MAX_OPEN_TAIL = 12; // `<scratchpad>`
const MAX_CLOSE_TAIL = 13; // `</scratchpad>`

export interface ThinkTagFilterOptions {
    /** Receives text captured inside recognized tags. Not called when omitted. */
    readonly onThinking?: (chunk: string) => void;
}

export class ThinkTagFilter {
    private buffer = '';
    private inside = false;
    private readonly onThinking?: (chunk: string) => void;

    constructor(options: ThinkTagFilterOptions = {}) {
        this.onThinking = options.onThinking;
    }

    push(chunk: string): string {
        this.buffer += chunk;
        let out = '';
        while (this.buffer.length > 0) {
            if (!this.inside) {
                const match = OPEN_TAG.exec(this.buffer);
                if (match) {
                    out += this.buffer.slice(0, match.index);
                    this.buffer = this.buffer.slice(match.index + match[0].length);
                    this.inside = true;
                    continue;
                }
                const tail = findTagPrefixTail(this.buffer, MAX_OPEN_TAIL);
                if (tail === 0) {
                    out += this.buffer;
                    this.buffer = '';
                } else {
                    out += this.buffer.slice(0, this.buffer.length - tail);
                    this.buffer = this.buffer.slice(this.buffer.length - tail);
                }
                return out;
            }
            const match = CLOSE_TAG.exec(this.buffer);
            if (match) {
                this.emitThinking(this.buffer.slice(0, match.index));
                this.buffer = this.buffer.slice(match.index + match[0].length);
                this.inside = false;
                continue;
            }
            const tail = findTagPrefixTail(this.buffer, MAX_CLOSE_TAIL);
            if (tail === 0) {
                this.emitThinking(this.buffer);
                this.buffer = '';
            } else {
                this.emitThinking(this.buffer.slice(0, this.buffer.length - tail));
                this.buffer = this.buffer.slice(this.buffer.length - tail);
            }
            return out;
        }
        return out;
    }

    flush(): string {
        if (this.inside) {
            if (this.buffer.length > 0) this.emitThinking(this.buffer);
            this.buffer = '';
            this.inside = false;
            return '';
        }
        const rest = this.buffer;
        this.buffer = '';
        return rest;
    }

    private emitThinking(text: string): void {
        if (!text || !this.onThinking) return;
        try { this.onThinking(text); } catch { /* callbacks must not break the stream */ }
    }
}

/**
 * Returns the length of the tail of `s` that begins at the last '<' and
 * whose length is ≤ max. Returns 0 if no such tail exists (so the whole
 * buffer is safe to emit / discard).
 */
function findTagPrefixTail(s: string, max: number): number {
    const idx = s.lastIndexOf('<');
    if (idx < 0) return 0;
    const tail = s.length - idx;
    return tail <= max ? tail : 0;
}
