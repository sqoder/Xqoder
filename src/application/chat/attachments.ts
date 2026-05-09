import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MessageAttachment } from '@xqoder/shared';

export const MAX_EDITOR_ATTACHMENTS = 5;
export const MAX_BINARY_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const IMAGE_MIME_TYPES: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
};

const FILE_MIME_TYPES: Record<string, string> = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export interface AttachmentIssue {
    filePath: string;
    reason: 'missing' | 'too_large' | 'unreadable';
}

export function formatAttachmentDisplayLabel(filePath: string): string {
    const fileName = path.basename(filePath);
    return fileName.length > 10 ? `${fileName.slice(0, 7)}...` : fileName;
}

export function appendEditorAttachment(
    existingAttachments: string[],
    nextAttachment: string,
): { attachments: string[]; status: 'added' | 'duplicate' | 'limit' } {
    const normalizedAttachment = path.resolve(nextAttachment);
    const normalizedExisting = existingAttachments.map((attachment) => path.resolve(attachment));

    if (normalizedExisting.includes(normalizedAttachment)) {
        return {
            attachments: existingAttachments,
            status: 'duplicate',
        };
    }

    if (existingAttachments.length >= MAX_EDITOR_ATTACHMENTS) {
        return {
            attachments: existingAttachments,
            status: 'limit',
        };
    }

    return {
        attachments: [...existingAttachments, normalizedAttachment],
        status: 'added',
    };
}

function inferAttachmentType(filePath: string): { type: MessageAttachment['type']; mimeType: string } {
    const ext = path.extname(filePath).toLowerCase();
    const imageMimeType = IMAGE_MIME_TYPES[ext];
    if (imageMimeType) {
        return {
            type: 'image',
            mimeType: imageMimeType,
        };
    }

    return {
        type: 'file',
        mimeType: FILE_MIME_TYPES[ext] ?? 'application/octet-stream',
    };
}

export function buildMessageAttachments(filePaths: string[]): {
    attachments: MessageAttachment[];
    issues: AttachmentIssue[];
} {
    const attachments: MessageAttachment[] = [];
    const issues: AttachmentIssue[] = [];

    for (const filePath of filePaths) {
        const resolvedPath = path.resolve(filePath);
        let stat: fs.Stats;
        try {
            stat = fs.statSync(resolvedPath);
        } catch {
            issues.push({ filePath: resolvedPath, reason: 'missing' });
            continue;
        }

        const inferred = inferAttachmentType(resolvedPath);
        if (inferred.type === 'image') {
            if (stat.size > MAX_BINARY_ATTACHMENT_BYTES) {
                issues.push({ filePath: resolvedPath, reason: 'too_large' });
                continue;
            }

            try {
                const content = fs.readFileSync(resolvedPath);
                attachments.push({
                    type: 'image',
                    mimeType: inferred.mimeType,
                    data: content.toString('base64'),
                    filePath: resolvedPath,
                    fileName: path.basename(resolvedPath),
                });
            } catch {
                issues.push({ filePath: resolvedPath, reason: 'unreadable' });
            }
            continue;
        }

        attachments.push({
            type: 'file',
            mimeType: inferred.mimeType,
            filePath: resolvedPath,
            fileName: path.basename(resolvedPath),
        });
    }

    return { attachments, issues };
}

function toPromptPath(filePath: string, cwd: string): string {
    const resolvedPath = path.resolve(filePath);
    const relativePath = path.relative(cwd, resolvedPath);

    if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
        return relativePath || path.basename(resolvedPath);
    }

    return resolvedPath;
}

export function buildAttachmentPromptText(text: string, attachments: string[], cwd: string): string {
    if (attachments.length === 0) {
        return text;
    }

    const attachmentLines = attachments.map((attachment) => `- ${toPromptPath(attachment, cwd)}`);

    return `${text}\n\n[AttachedFiles]\nThe user attached these files to this request:\n${attachmentLines.join('\n')}\nTreat them as part of the request context and read them directly when needed.\n[/AttachedFiles]`;
}
