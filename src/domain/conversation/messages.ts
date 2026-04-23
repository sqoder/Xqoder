export interface ConversationTranscriptToolSignal {
    id: string;
    name: string;
    success: boolean;
}

export interface ConversationTranscriptVerificationSignal {
    id: string;
    ok: boolean;
    blocked: boolean;
    summary: string;
    messages: string[];
}

export type ConversationTranscriptEntry =
    | {
        type: 'user';
        content: string;
    }
    | {
        type: 'assistant';
        content: string;
    }
    | {
        type: 'tool';
        content: string;
        toolCallId?: string;
        toolName?: string;
        success?: boolean;
    }
    | {
        type: 'verification';
        content: string;
        ok?: boolean;
        blocked?: boolean;
        summary?: string;
    };

export interface ConversationTranscriptMessage {
    role: string;
    content: string;
    toolCallId?: string;
}

export function buildConversationTranscript(input: {
    messages: ConversationTranscriptMessage[];
    toolHistory?: ConversationTranscriptToolSignal[];
    verificationHistory?: ConversationTranscriptVerificationSignal[];
}): ConversationTranscriptEntry[] {
    const toolSignalsById = new Map(
        (input.toolHistory ?? []).map((entry) => [entry.id, entry] as const),
    );
    const verificationQueue = flattenVerificationMessages(input.verificationHistory ?? []);
    let verificationIndex = 0;

    const transcript: ConversationTranscriptEntry[] = [];

    for (const message of input.messages) {
        if (message.role === 'user') {
            transcript.push({
                type: 'user',
                content: String(message.content ?? ''),
            });
            continue;
        }

        if (message.role === 'assistant') {
            transcript.push({
                type: 'assistant',
                content: String(message.content ?? ''),
            });
            continue;
        }

        if (message.role === 'tool') {
            const toolSignal = message.toolCallId
                ? toolSignalsById.get(message.toolCallId)
                : undefined;
            transcript.push({
                type: 'tool',
                content: String(message.content ?? ''),
                ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
                ...(toolSignal?.name ? { toolName: toolSignal.name } : {}),
                ...(typeof toolSignal?.success === 'boolean' ? { success: toolSignal.success } : {}),
            });
            continue;
        }

        if (message.role !== 'system') {
            continue;
        }

        const normalizedContent = normalizeTranscriptText(message.content);
        if (!normalizedContent) {
            continue;
        }

        const verificationSignal = verificationQueue[verificationIndex];
        if (verificationSignal && normalizedContent === verificationSignal.content) {
            transcript.push({
                type: 'verification',
                content: normalizedContent,
                ok: verificationSignal.ok,
                blocked: verificationSignal.blocked,
                summary: verificationSignal.summary,
            });
            verificationIndex += 1;
            continue;
        }

        if (looksLikeVerificationMessage(normalizedContent)) {
            transcript.push({
                type: 'verification',
                content: normalizedContent,
            });
        }
    }

    return transcript;
}

function flattenVerificationMessages(
    signals: ConversationTranscriptVerificationSignal[],
): Array<{ content: string; ok: boolean; blocked: boolean; summary: string }> {
    return signals.flatMap((signal) => {
        const messages = signal.messages
            .map(normalizeTranscriptText)
            .filter((message): message is string => Boolean(message));

        if (messages.length === 0) {
            const summary = normalizeTranscriptText(signal.summary);
            return summary
                ? [{ content: summary, ok: signal.ok, blocked: signal.blocked, summary: summary }]
                : [];
        }

        return messages.map((message) => ({
            content: message,
            ok: signal.ok,
            blocked: signal.blocked,
            summary: normalizeTranscriptText(signal.summary) || message,
        }));
    });
}

function looksLikeVerificationMessage(content: string): boolean {
    return /^verification\b/i.test(content);
}

function normalizeTranscriptText(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}
