import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    extractLspRange,
    toFilePath,
} from './lsp-utils-internal.js';

interface TextEditMatchLike {
    filePath: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
    newText: string;
}

interface RenameMatchLike {
    filePaths: string[];
    edits: TextEditMatchLike[];
    totalEdits: number;
    placeholder?: string;
}

export function parseWorkspaceEditResult(value: unknown): RenameMatchLike | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const edits: TextEditMatchLike[] = [];
    let placeholder: string | undefined;

    if (candidate['changes'] && typeof candidate['changes'] === 'object') {
        for (const [uri, fileEdits] of Object.entries(candidate['changes'] as Record<string, unknown>)) {
            edits.push(...toTextEditMatches(uri, fileEdits));
        }
    }

    if (Array.isArray(candidate['documentChanges'])) {
        for (const change of candidate['documentChanges']) {
            if (!change || typeof change !== 'object') {
                continue;
            }

            const changeRecord = change as Record<string, unknown>;
            if (changeRecord['textDocument'] && Array.isArray(changeRecord['edits'])) {
                const textDocument = changeRecord['textDocument'] as Record<string, unknown>;
                if (typeof textDocument['uri'] === 'string') {
                    edits.push(...toTextEditMatches(textDocument['uri'], changeRecord['edits']));
                }
            }

            if (typeof changeRecord['placeholder'] === 'string') {
                placeholder = changeRecord['placeholder'];
            }
        }
    }

    if (edits.length === 0) {
        return null;
    }

    return {
        filePaths: Array.from(new Set(edits.map((edit) => edit.filePath))),
        edits,
        totalEdits: edits.length,
        ...(placeholder ? { placeholder } : {}),
    };
}

export function containsUnsupportedWorkspaceChanges(edit: Record<string, unknown>): boolean {
    if (!Array.isArray(edit['documentChanges'])) {
        return false;
    }

    return edit['documentChanges'].some((change) => {
        if (!change || typeof change !== 'object') {
            return true;
        }

        const changeRecord = change as Record<string, unknown>;
        return !(changeRecord['textDocument'] && Array.isArray(changeRecord['edits']));
    });
}

export function applyWorkspaceEdits(edits: TextEditMatchLike[]): void {
    const grouped = new Map<string, TextEditMatchLike[]>();

    for (const edit of edits) {
        const existing = grouped.get(edit.filePath) ?? [];
        existing.push(edit);
        grouped.set(edit.filePath, existing);
    }

    for (const [filePath, fileEdits] of grouped.entries()) {
        const currentContent = fs.existsSync(filePath)
            ? fs.readFileSync(filePath, 'utf-8')
            : '';
        const nextContent = applyTextEditsToContent(currentContent, fileEdits);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, nextContent, 'utf-8');
    }
}

function toTextEditMatches(uri: string, value: unknown): TextEditMatchLike[] {
    const filePath = toFilePath(uri);
    if (!filePath || !Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }

            const candidate = entry as Record<string, unknown>;
            const range = extractLspRange(candidate['range']);
            if (!range || typeof candidate['newText'] !== 'string') {
                return null;
            }

            return {
                filePath,
                startLine: range.start.line + 1,
                startCharacter: range.start.character + 1,
                endLine: range.end.line + 1,
                endCharacter: range.end.character + 1,
                newText: candidate['newText'],
            };
        })
        .filter((entry): entry is TextEditMatchLike => entry !== null);
}

function applyTextEditsToContent(content: string, edits: TextEditMatchLike[]): string {
    const normalized = edits
        .map((edit) => ({
            ...edit,
            startOffset: positionToOffset(content, edit.startLine, edit.startCharacter),
            endOffset: positionToOffset(content, edit.endLine, edit.endCharacter),
        }))
        .sort((left, right) => {
            if (left.startOffset !== right.startOffset) {
                return right.startOffset - left.startOffset;
            }
            return right.endOffset - left.endOffset;
        });

    let nextContent = content;
    let lastStart = Number.POSITIVE_INFINITY;

    for (const edit of normalized) {
        if (edit.endOffset > lastStart) {
            throw new Error(`Detected overlapping edit: ${edit.filePath}:${edit.startLine}:${edit.startCharacter}`);
        }
        nextContent = `${nextContent.slice(0, edit.startOffset)}${edit.newText}${nextContent.slice(edit.endOffset)}`;
        lastStart = edit.startOffset;
    }

    return nextContent;
}

function positionToOffset(content: string, line: number, character: number): number {
    const normalizedLine = Math.max(1, Math.floor(line));
    const normalizedCharacter = Math.max(1, Math.floor(character));
    const lines = content.split('\n');
    let offset = 0;

    for (let index = 0; index < normalizedLine - 1 && index < lines.length; index += 1) {
        offset += lines[index].length + 1;
    }

    const targetLine = lines[Math.min(normalizedLine - 1, lines.length - 1)] ?? '';
    return offset + Math.min(targetLine.length, normalizedCharacter - 1);
}
