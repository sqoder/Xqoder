// P20a — ThinkingTokenExtractor: splits a text blob containing
// <think>...</think> (or the other recognized reasoning tags) into two
// streams: visible content + hidden thinking.
//
// Distinct from P05's ThinkTagFilter, which STRIPS tags and forwards
// only the visible content (optionally emitting tag text via a side
// callback). This module exists for non-streaming consumers: a full
// string in → `{ visible, thinking }` out. The streaming path keeps
// using ThinkTagFilter.
//
// Tag vocabulary matches ThinkTagFilter: think/thinking/scratchpad/
// reasoning/thought (case-insensitive). If tags are unbalanced, trailing
// orphan content after a final open tag is treated as thinking; orphan
// close tags are left verbatim in `visible`.

const TAG_PATTERN = /<\s*(\/?)\s*(think|thinking|scratchpad|reasoning|thought)\s*>/gi;

export interface ExtractedThinking {
    readonly visible: string;
    readonly thinking: string;
}

export function extractThinking(rawContent: string): ExtractedThinking {
    if (!rawContent) {
        return { visible: '', thinking: '' };
    }

    let visible = '';
    let thinking = '';
    let cursor = 0;
    let inside = false;

    for (const match of rawContent.matchAll(TAG_PATTERN)) {
        const index = match.index ?? 0;
        const slash = match[1];
        const preceding = rawContent.slice(cursor, index);
        if (inside) {
            thinking += preceding;
        } else {
            visible += preceding;
        }
        cursor = index + match[0].length;

        if (slash === '') {
            // open tag
            inside = true;
        } else {
            // close tag; if we were not inside, leave the close verbatim
            if (!inside) {
                visible += match[0];
            }
            inside = false;
        }
    }

    // Trailing content after the last matched tag.
    const rest = rawContent.slice(cursor);
    if (inside) {
        thinking += rest;
    } else {
        visible += rest;
    }

    return { visible, thinking };
}

/**
 * Convenience: returns true when the input contains at least one open
 * thinking tag.
 */
export function containsThinking(rawContent: string): boolean {
    return /<\s*(think|thinking|scratchpad|reasoning|thought)\s*>/i.test(rawContent);
}
