import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MessageAttachment } from '@xqoder/shared';
import { MAX_EDITOR_ATTACHMENTS, buildMessageAttachments } from '../attachments.js';

const MENTION_RE = /(?:^|[\s("'`])@([A-Za-z0-9_.\-/]+\.[A-Za-z0-9]{1,10})(?=$|[\s)"'`,:;])/g;

export interface ExpandMentionsResult {
    attachments: MessageAttachment[];
    resolvedPaths: string[];
    missing: string[];
}

export function expandMentions(text: string, cwd: string): ExpandMentionsResult {
    if (process.env.XQODER_DISABLE_MENTION_EXPANSION === '1') {
        return { attachments: [], resolvedPaths: [], missing: [] };
    }

    const seen = new Set<string>();
    const candidates: string[] = [];
    const resolved: string[] = [];
    const missing: string[] = [];

    for (const match of text.matchAll(MENTION_RE)) {
        const raw = match[1];
        if (!raw || seen.has(raw)) {
            continue;
        }
        seen.add(raw);
        candidates.push(raw);
    }

    for (const candidate of candidates) {
        if (candidates.length > 0 && resolved.length >= MAX_EDITOR_ATTACHMENTS) {
            break;
        }
        const abs = path.resolve(cwd, candidate);
        if (!isInsideCwd(abs, cwd)) {
            continue;
        }
        try {
            const stat = fs.statSync(abs);
            if (!stat.isFile()) {
                missing.push(candidate);
                continue;
            }
            resolved.push(abs);
        } catch {
            missing.push(candidate);
        }
    }

    if (resolved.length === 0) {
        return { attachments: [], resolvedPaths: [], missing };
    }

    const { attachments } = buildMessageAttachments(resolved);
    return {
        attachments,
        resolvedPaths: resolved,
        missing,
    };
}

function isInsideCwd(abs: string, cwd: string): boolean {
    const relative = path.relative(path.resolve(cwd), abs);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
