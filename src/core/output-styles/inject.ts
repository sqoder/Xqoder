// P17 — Output-style prompt injection.
//
// `appendOutputStyleTail` takes a base system prompt + the currently-selected
// output style and returns a new prompt with the style's
// `systemPromptAppend` appended as a dynamic tail. The tail is tagged so
// downstream parsers (e.g. when reconstructing cache-safe prefix)
// can detect + strip it.
//
// Design notes:
//   - Pure function: no fs/session access. Selection is resolved upstream.
//   - If the style has no append text or is undefined, the prompt is returned
//     unchanged — this is the "no style selected" path.

import type { OutputStyleFile } from './load-dir.js';

export function appendOutputStyleTail(
    prompt: string,
    style: OutputStyleFile | undefined,
): string {
    if (!style || !style.systemPromptAppend) {
        return prompt;
    }

    const tail = `[OutputStyle=${style.name}]\n${style.systemPromptAppend.trim()}`;
    if (!prompt.trim()) {
        return tail;
    }
    return `${prompt}\n\n${tail}`;
}
