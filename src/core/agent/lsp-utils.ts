import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { LSPServerConfig, LSPTcpServerConfig } from '@xqoder/shared';

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

export function parseContentLength(header: string): number | null {
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
        return null;
    }
    return Number.parseInt(match[1] ?? '', 10);
}

export function supportsProvider(value: unknown): boolean {
    return value === true || (typeof value === 'object' && value !== null);
}

export function isTcpServerConfig(config: LSPServerConfig): config is LSPTcpServerConfig {
    return config.transport === 'tcp';
}

export function resolveServerCwd(configuredCwd: string | undefined, projectRoot: string, fallbackCwd: string): string {
    if (!configuredCwd) {
        return fallbackCwd;
    }
    return path.isAbsolute(configuredCwd)
        ? configuredCwd
        : path.resolve(projectRoot, configuredCwd);
}

export async function connectTcpSocket(input: {
    host: string;
    port: number;
    timeoutMs: number;
}): Promise<net.Socket> {
    const startedAt = Date.now();
    let lastError: Error | undefined;

    while (Date.now() - startedAt < input.timeoutMs) {
        try {
            return await new Promise<net.Socket>((resolve, reject) => {
                const socket = net.createConnection({
                    host: input.host,
                    port: input.port,
                });
                const attemptTimeout = Math.max(150, Math.min(1_000, input.timeoutMs));
                const timer = setTimeout(() => {
                    socket.destroy(new Error('TCP connection timeout'));
                }, attemptTimeout);

                const cleanup = () => {
                    clearTimeout(timer);
                    socket.off('connect', handleConnect);
                    socket.off('error', handleError);
                };
                const handleConnect = () => {
                    cleanup();
                    socket.setNoDelay(true);
                    resolve(socket);
                };
                const handleError = (error: Error) => {
                    cleanup();
                    socket.destroy();
                    reject(error);
                };

                socket.once('connect', handleConnect);
                socket.once('error', handleError);
            });
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            await delay(75);
        }
    }

    throw new Error(`Unable to connect to TCP LSP ${input.host}:${input.port}: ${lastError?.message ?? 'unknown error'}`);
}

export function resolveLanguageId(config: LSPServerConfig, filePath: string): string {
    if (config.languageId) {
        return config.languageId;
    }
    const extension = path.extname(filePath).replace(/^\./, '');
    return extension || 'plaintext';
}

export function toLspPosition(line: number, character: number): { line: number; character: number } {
    return {
        line: Math.max(0, Math.floor(line) - 1),
        character: Math.max(0, Math.floor(character) - 1),
    };
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

export function formatServerMessage(params: unknown): string {
    if (!params || typeof params !== 'object') {
        return String(params ?? '');
    }

    const candidate = params as Record<string, unknown>;
    if (typeof candidate['message'] === 'string') {
        return candidate['message'];
    }

    return JSON.stringify(candidate);
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
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

function extractLspRange(value: unknown): {
    start: {
        line: number;
        character: number;
    };
    end: {
        line: number;
        character: number;
    };
} | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const start = extractLspPosition(candidate['start']);
    const end = extractLspPosition(candidate['end']);
    if (!start || !end) {
        return null;
    }

    return {
        start,
        end,
    };
}

function extractLspPosition(value: unknown): {
    line: number;
    character: number;
} | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const line = Number(candidate['line']);
    const character = Number(candidate['character']);
    if (!Number.isFinite(line) || !Number.isFinite(character)) {
        return null;
    }

    return {
        line,
        character,
    };
}

function extractMarkedText(value: unknown): string | null {
    if (typeof value === 'string') {
        return value.trim() || null;
    }

    if (Array.isArray(value)) {
        const parts = value
            .map((entry) => extractMarkedText(entry))
            .filter((entry): entry is string => Boolean(entry));
        return parts.length > 0 ? parts.join('\n\n') : null;
    }

    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    if (typeof candidate['value'] === 'string') {
        const prefix = typeof candidate['language'] === 'string'
            ? `\`\`\`${candidate['language']}\n${candidate['value']}\n\`\`\``
            : candidate['value'];
        return prefix.trim() || null;
    }

    return null;
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

export function toFilePath(uri: string): string | null {
    try {
        return path.resolve(fileURLToPath(uri));
    } catch {
        return null;
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
