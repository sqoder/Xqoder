import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
    extractLspRange,
    extractMarkedText,
    toFilePath,
} from './lsp-utils-internal.js';

interface WorkspaceSymbolMatchLike {
    kind: string;
    name: string;
    filePath: string;
    line: number;
    character: number;
    preview: string;
    containerName?: string;
}

interface DiagnosticMatchLike {
    severity: string;
    code: string;
    filePath: string;
    line: number;
    character: number;
    message: string;
}

interface LocationMatchLike {
    filePath: string;
    line: number;
    character: number;
    preview: string;
    kind?: string;
}

interface HoverMatchLike {
    contents: string;
    range?: {
        line: number;
        character: number;
        endLine: number;
        endCharacter: number;
    };
}

interface CompletionMatchLike {
    label: string;
    kind?: string;
    detail?: string;
    documentation?: string;
    insertText?: string;
    sortText?: string;
    resolved?: boolean;
}

export function toWorkspaceSymbolMatch(value: unknown): WorkspaceSymbolMatchLike | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const location = extractLocation(candidate['location']);
    if (!location || typeof candidate['name'] !== 'string') {
        return null;
    }

    return {
        kind: String(candidate['kind'] ?? 'symbol'),
        name: candidate['name'],
        filePath: location.filePath,
        line: location.line,
        character: location.character,
        preview: location.preview,
        ...(typeof candidate['containerName'] === 'string' ? { containerName: candidate['containerName'] } : {}),
    };
}

export function parseLocationResult(value: unknown): LocationMatchLike[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => extractLocation(entry))
            .filter((location): location is LocationMatchLike => location !== null);
    }

    const single = extractLocation(value);
    return single ? [single] : [];
}

export function parseHoverResult(value: unknown): HoverMatchLike | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const contents = extractMarkedText(candidate['contents']);
    if (!contents) {
        return null;
    }

    const range = extractLspRange(candidate['range']);

    return {
        contents,
        ...(range ? {
            range: {
                line: range.start.line + 1,
                character: range.start.character + 1,
                endLine: range.end.line + 1,
                endCharacter: range.end.character + 1,
            },
        } : {}),
    };
}

export function extractCompletionItems(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
    }

    if (!value || typeof value !== 'object') {
        return [];
    }

    const candidate = value as Record<string, unknown>;
    if (!Array.isArray(candidate['items'])) {
        return [];
    }

    return candidate['items']
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
}

export function toCompletionMatch(value: unknown): CompletionMatchLike | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    if (typeof candidate['label'] !== 'string') {
        return null;
    }

    return {
        label: candidate['label'],
        ...(candidate['kind'] !== undefined ? { kind: String(candidate['kind']) } : {}),
        ...(typeof candidate['detail'] === 'string' ? { detail: candidate['detail'] } : {}),
        ...(typeof candidate['insertText'] === 'string' ? { insertText: candidate['insertText'] } : {}),
        ...(typeof candidate['sortText'] === 'string' ? { sortText: candidate['sortText'] } : {}),
        ...(typeof candidate['detail'] === 'string' || extractMarkedText(candidate['documentation']) ? { resolved: true } : {}),
        ...(extractMarkedText(candidate['documentation']) ? { documentation: extractMarkedText(candidate['documentation']) ?? undefined } : {}),
    };
}

export function parseDiagnosticReport(filePath: string, report: Record<string, unknown>): DiagnosticMatchLike[] {
    const items = Array.isArray(report['items'])
        ? report['items']
        : isRelatedFullReport(report)
            ? (Array.isArray((report['relatedDocuments'] as Record<string, unknown>)?.[pathToFileURL(filePath).toString()]) ? [] : [])
            : [];

    if (Array.isArray(items) && items.length > 0) {
        return items
            .map((entry) => toDiagnosticMatch(entry, filePath))
            .filter((match): match is DiagnosticMatchLike => match !== null);
    }

    return [];
}

export function toDiagnosticMatch(value: unknown, filePath: string): DiagnosticMatchLike | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const range = candidate['range'];
    if (!range || typeof range !== 'object') {
        return null;
    }

    const start = (range as Record<string, unknown>)['start'];
    if (!start || typeof start !== 'object') {
        return null;
    }

    const line = Number((start as Record<string, unknown>)['line']);
    const character = Number((start as Record<string, unknown>)['character']);

    return {
        severity: toDiagnosticSeverity(candidate['severity']),
        code: String(candidate['code'] ?? 'LSP'),
        filePath,
        line: Number.isFinite(line) ? line + 1 : 1,
        character: Number.isFinite(character) ? character + 1 : 1,
        message: String(candidate['message'] ?? ''),
    };
}

export { toFilePath };

function extractLocation(value: unknown): LocationMatchLike | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const uriValue = typeof candidate['uri'] === 'string'
        ? candidate['uri']
        : typeof candidate['targetUri'] === 'string'
            ? candidate['targetUri']
            : null;

    const rangeValue = candidate['range'] ?? candidate['targetSelectionRange'];
    if (!uriValue || !rangeValue || typeof rangeValue !== 'object') {
        return null;
    }

    const range = rangeValue as Record<string, unknown>;
    const start = range['start'];
    if (!start || typeof start !== 'object') {
        return null;
    }

    const position = start as Record<string, unknown>;
    const filePath = toFilePath(uriValue);
    if (!filePath) {
        return null;
    }

    const line = Number(position['line']);
    const character = Number(position['character']);

    return {
        filePath,
        line: Number.isFinite(line) ? line + 1 : 1,
        character: Number.isFinite(character) ? character + 1 : 1,
        preview: getLinePreview(filePath, Number.isFinite(line) ? line + 1 : 1),
    };
}

function isRelatedFullReport(report: Record<string, unknown>): boolean {
    return typeof report['kind'] === 'string' && report['kind'] === 'full';
}

function toDiagnosticSeverity(value: unknown): string {
    switch (value) {
        case 1:
            return 'ERROR';
        case 2:
            return 'WARNING';
        case 3:
            return 'INFORMATION';
        case 4:
            return 'HINT';
        default:
            return 'UNKNOWN';
    }
}

function getLinePreview(filePath: string, lineNumber: number): string {
    try {
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
        return lines[lineNumber - 1]?.trim() ?? '';
    } catch {
        return '';
    }
}
