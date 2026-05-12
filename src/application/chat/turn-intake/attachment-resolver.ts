import type { MessageAttachment } from '@xqoder/shared';
import { expandMentions } from './mention-expander.js';

export interface ResolveTurnAttachmentsInput {
    prompt: string;
    cwd: string;
    userProvided?: MessageAttachment[];
}

export interface ResolveTurnAttachmentsResult {
    attachments: MessageAttachment[];
    mentionPaths: string[];
    missingMentions: string[];
}

export function resolveTurnAttachments(input: ResolveTurnAttachmentsInput): ResolveTurnAttachmentsResult {
    const userProvided = (input.userProvided ?? []).map((attachment) => ({ ...attachment }));
    const seen = new Set<string>(
        userProvided
            .map((attachment) => attachment.filePath)
            .filter((p): p is string => typeof p === 'string'),
    );

    const { attachments: mentionAttachments, resolvedPaths, missing } = expandMentions(input.prompt, input.cwd);
    const combined = [...userProvided];
    for (const attachment of mentionAttachments) {
        const key = attachment.filePath;
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        combined.push(attachment);
    }

    return {
        attachments: combined,
        mentionPaths: resolvedPaths,
        missingMentions: missing,
    };
}
