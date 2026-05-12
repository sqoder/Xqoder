// P24b — ConversationArc: keyword-heuristic topic segmentation.
//
// Splits a message list into named segments ("arcs") based on topic shifts.
// v1 uses a sliding-window keyword approach — fast, zero deps, good enough
// for the `xqoder session arc` display use case. A future v2 could use
// embeddings or an LLM call for higher accuracy.

export interface ArcSegment {
    /** Human-readable title derived from the first user message in the segment. */
    title: string;
    /** 0-based index of the first message in this segment. */
    startIndex: number;
    /** 0-based index of the last message in this segment (inclusive). */
    endIndex: number;
    /** Number of messages in this segment. */
    messageCount: number;
}

export interface ConversationArc {
    segments: ArcSegment[];
    totalMessages: number;
}

/** Minimal message shape required by computeArc — compatible with LLMMessage and SessionMessageView. */
export interface ArcMessage {
    role: string;
    content?: string | unknown;
}

// ---------------------------------------------------------------------------
// Keyword sets that signal a topic shift
// ---------------------------------------------------------------------------

const TOPIC_SHIFT_PATTERNS: RegExp[] = [
    /\b(now|next|let'?s|also|additionally|another|switch|change|move on|different|new task|new feature|new file|new function)\b/i,
    /^(ok|okay|great|done|got it|thanks|thank you|perfect|alright)[,.]?\s/i,
    /\b(instead|actually|wait|hold on|before that|first|second|third)\b/i,
];

const MIN_SEGMENT_MESSAGES = 3;
const MAX_SEGMENTS = 10;

/**
 * Compute a conversation arc from a list of messages.
 * Returns segments in order; each segment has a title derived from the
 * first user message in that segment.
 */
export function computeArc(messages: ArcMessage[]): ConversationArc {
    if (messages.length === 0) {
        return { segments: [], totalMessages: 0 };
    }

    const userMessages = messages
        .map((m, i) => ({ message: m, index: i }))
        .filter(({ message }) => message.role === 'user');

    if (userMessages.length === 0) {
        return {
            segments: [buildSegment(messages, 0, messages.length - 1)],
            totalMessages: messages.length,
        };
    }

    // Find topic-shift boundaries among user messages
    const boundaries: number[] = [0]; // always start a segment at 0

    for (let i = 1; i < userMessages.length; i++) {
        const prev = userMessages[i - 1]!;
        const curr = userMessages[i]!;

        // Only consider a shift if there's been enough messages since the last boundary
        const lastBoundary = boundaries[boundaries.length - 1]!;
        if (curr.index - lastBoundary < MIN_SEGMENT_MESSAGES) continue;

        const content = typeof curr.message.content === 'string'
            ? curr.message.content
            : '';

        if (isTopicShift(content, prev.message)) {
            boundaries.push(curr.index);
            if (boundaries.length >= MAX_SEGMENTS) break;
        }
    }

    // Build segments from boundaries
    const segments: ArcSegment[] = [];
    for (let i = 0; i < boundaries.length; i++) {
        const start = boundaries[i]!;
        const end = i + 1 < boundaries.length ? boundaries[i + 1]! - 1 : messages.length - 1;
        segments.push(buildSegment(messages, start, end));
    }

    return { segments, totalMessages: messages.length };
}

function isTopicShift(content: string, _prevMessage: ArcMessage): boolean {
    return TOPIC_SHIFT_PATTERNS.some((pattern) => pattern.test(content));
}

function buildSegment(messages: ArcMessage[], start: number, end: number): ArcSegment {
    // Title = first user message content in this segment, truncated
    const firstUser = messages
        .slice(start, end + 1)
        .find((m) => m.role === 'user');

    const rawContent = typeof firstUser?.content === 'string'
        ? firstUser.content.trim()
        : '';

    const title = rawContent.length > 60
        ? `${rawContent.slice(0, 57)}…`
        : rawContent || `Messages ${start + 1}–${end + 1}`;

    return {
        title,
        startIndex: start,
        endIndex: end,
        messageCount: end - start + 1,
    };
}

/**
 * Format a ConversationArc for terminal display.
 */
export function formatArc(arc: ConversationArc): string {
    if (arc.segments.length === 0) return '(no messages)';
    return arc.segments
        .map((seg, i) => {
            const label = `${i + 1}. ${seg.title}`;
            const range = `  [msg ${seg.startIndex + 1}–${seg.endIndex + 1}, ${seg.messageCount} messages]`;
            return `${label}\n${range}`;
        })
        .join('\n\n');
}
