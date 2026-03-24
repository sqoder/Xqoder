import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ExtractAttachmentReferencesResult {
    text: string;
    attachmentPaths: string[];
}

export interface MergeAttachmentPathsResult {
    paths: string[];
    addedCount: number;
    skippedDuplicateCount: number;
    skippedLimitCount: number;
}

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;
const TRAILING_PUNCTUATION_RE = /[),.;:!?\]\}]+$/;
const ATTACHMENT_REFERENCE_RE = /(^|[\s(])@(?:"([^"\n]+)"|'([^'\n]+)'|([^\s'"`]+))/g;

function resolveInputPath(cwd: string, rawInput: string): string {
    if (rawInput.startsWith('~/')) {
        return path.resolve(os.homedir(), rawInput.slice(2));
    }
    if (WINDOWS_ABSOLUTE_RE.test(rawInput)) {
        return path.normalize(rawInput);
    }
    if (path.isAbsolute(rawInput)) {
        return path.normalize(rawInput);
    }
    return path.resolve(cwd, rawInput);
}

function normalizeCandidate(candidate: string): string {
    return candidate.trim().replace(TRAILING_PUNCTUATION_RE, '');
}

export function extractAttachmentReferencesFromPrompt(
    text: string,
    cwd: string,
): ExtractAttachmentReferencesResult {
    const attachmentPaths: string[] = [];
    const seen = new Set<string>();

    const replaced = text.replace(
        ATTACHMENT_REFERENCE_RE,
        (fullMatch, prefix: string, doubleQuoted: string | undefined, singleQuoted: string | undefined, bare: string | undefined) => {
            const rawCandidate = doubleQuoted ?? singleQuoted ?? bare ?? '';
            const normalizedCandidate = normalizeCandidate(rawCandidate);
            if (!normalizedCandidate) {
                return fullMatch;
            }

            const resolvedPath = resolveInputPath(cwd, normalizedCandidate);
            if (!fs.existsSync(resolvedPath)) {
                return fullMatch;
            }

            if (!seen.has(resolvedPath)) {
                seen.add(resolvedPath);
                attachmentPaths.push(resolvedPath);
            }

            return prefix;
        },
    );

    const normalizedText = replaced
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .trim();

    return {
        text: normalizedText.length > 0 ? normalizedText : text.trim(),
        attachmentPaths,
    };
}

export function mergeAttachmentPaths(
    existingPaths: string[],
    discoveredPaths: string[],
    maxAttachments: number,
): MergeAttachmentPathsResult {
    const normalizedExisting = existingPaths.map((value) => path.resolve(value));
    const merged = [...normalizedExisting];
    const seen = new Set(merged);

    let addedCount = 0;
    let skippedDuplicateCount = 0;
    let skippedLimitCount = 0;

    for (const discoveredPath of discoveredPaths) {
        const normalized = path.resolve(discoveredPath);
        if (seen.has(normalized)) {
            skippedDuplicateCount += 1;
            continue;
        }
        if (merged.length >= maxAttachments) {
            skippedLimitCount += 1;
            continue;
        }
        seen.add(normalized);
        merged.push(normalized);
        addedCount += 1;
    }

    return {
        paths: merged,
        addedCount,
        skippedDuplicateCount,
        skippedLimitCount,
    };
}
