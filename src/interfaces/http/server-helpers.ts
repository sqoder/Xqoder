import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkspaceSymbolMatch } from '@xqoder/agent';

export type ProjectSymbolKind = 'function' | 'class' | 'interface' | 'type' | 'variable';

export interface ProjectSymbolMatch {
    name: string;
    kind: ProjectSymbolKind;
    path: string;
    line: number;
    text: string;
}

export interface ResolvedSymbolMatch extends ProjectSymbolMatch {
    source: 'lsp' | 'scan';
}

export interface ScoredSymbolMatch {
    score: number;
    value: ResolvedSymbolMatch;
}

export interface SymbolCursorPayload {
    query: string;
    kind?: string;
    offset: number;
}

export function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

export function jsonResponse(
    res: http.ServerResponse,
    status: number,
    data: unknown,
    corsHeaders: Record<string, string>,
): void {
    res.writeHead(status, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

export function resolvePathWithinRoot(projectRoot: string, inputPath: string): string | null {
    const root = path.resolve(projectRoot);
    const resolved = path.resolve(root, inputPath);
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
        return resolved;
    }
    return null;
}

export function listProjectFiles(root: string, limit = 1000): string[] {
    const skipped = new Set(['.git', 'node_modules', '.xqoder']);
    const queue = [root];
    const files: string[] = [];

    while (queue.length > 0 && files.length < limit) {
        const current = queue.shift();
        if (!current) {
            break;
        }
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (files.length >= limit) {
                break;
            }
            if (skipped.has(entry.name)) {
                continue;
            }
            const absolute = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(absolute);
                continue;
            }
            if (entry.isFile()) {
                files.push(absolute);
            }
        }
    }

    return files;
}

export function readTextFileSafe(filePath: string, maxBytes = 1024 * 1024): string {
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes) {
        throw new Error(`File too large (${stat.size} bytes, max ${maxBytes})`);
    }
    return fs.readFileSync(filePath, 'utf-8');
}

export function detectSymbolInLine(line: string): { name: string; kind: ProjectSymbolKind } | null {
    const trimmed = line.trim();
    if (!trimmed) {
        return null;
    }

    const functionMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/);
    if (functionMatch?.[1]) {
        return { name: functionMatch[1], kind: 'function' };
    }
    const classMatch = trimmed.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
    if (classMatch?.[1]) {
        return { name: classMatch[1], kind: 'class' };
    }
    const interfaceMatch = trimmed.match(/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/);
    if (interfaceMatch?.[1]) {
        return { name: interfaceMatch[1], kind: 'interface' };
    }
    const typeMatch = trimmed.match(/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/);
    if (typeMatch?.[1]) {
        return { name: typeMatch[1], kind: 'type' };
    }
    const variableMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/);
    if (variableMatch?.[1]) {
        return { name: variableMatch[1], kind: 'variable' };
    }
    const pythonFunctionMatch = trimmed.match(/^def\s+([A-Za-z_][\w]*)\s*\(/);
    if (pythonFunctionMatch?.[1]) {
        return { name: pythonFunctionMatch[1], kind: 'function' };
    }
    const pythonClassMatch = trimmed.match(/^class\s+([A-Za-z_][\w]*)\b/);
    if (pythonClassMatch?.[1]) {
        return { name: pythonClassMatch[1], kind: 'class' };
    }

    return null;
}

export function toResolvedLspSymbolMatch(
    match: WorkspaceSymbolMatch,
    projectRoot: string,
): ResolvedSymbolMatch | null {
    const kind = normalizeLspSymbolKind(match.kind);
    if (!kind) {
        return null;
    }
    return {
        name: match.name,
        kind,
        path: path.relative(projectRoot, match.filePath),
        line: match.line,
        text: match.preview,
        source: 'lsp',
    };
}

export function scoreSymbolMatch(query: string, symbol: ResolvedSymbolMatch): number {
    const name = symbol.name.toLowerCase();
    const loweredQuery = query.toLowerCase();
    let score = 0;

    if (name === loweredQuery) {
        score += 100;
    } else if (name.startsWith(loweredQuery)) {
        score += 70;
    } else if (name.includes(loweredQuery)) {
        score += 40;
    }

    if (symbol.source === 'lsp') {
        score += 20;
    }

    if (symbol.path.toLowerCase().includes(loweredQuery)) {
        score += 5;
    }

    return score;
}

export function upsertScoredSymbol(
    bucket: Map<string, ScoredSymbolMatch>,
    query: string,
    candidate: ResolvedSymbolMatch,
): void {
    const key = `${candidate.path}:${candidate.line}:${candidate.kind}:${candidate.name}`;
    const scored = {
        score: scoreSymbolMatch(query, candidate),
        value: candidate,
    };

    const existing = bucket.get(key);
    if (!existing || scored.score > existing.score) {
        bucket.set(key, scored);
    }
}

export function encodeSymbolCursor(payload: SymbolCursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
}

export function decodeSymbolCursor(raw: string): SymbolCursorPayload | null {
    try {
        const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
        const parsed = JSON.parse(decoded) as Partial<SymbolCursorPayload>;
        if (typeof parsed.query !== 'string' || typeof parsed.offset !== 'number' || !Number.isFinite(parsed.offset)) {
            return null;
        }
        return {
            query: parsed.query,
            ...(typeof parsed.kind === 'string' ? { kind: parsed.kind } : {}),
            offset: Math.max(0, Math.floor(parsed.offset)),
        };
    } catch {
        return null;
    }
}

function normalizeLspSymbolKind(kind: string): ProjectSymbolKind | null {
    const normalized = String(kind).trim().toLowerCase();
    switch (normalized) {
        case '5':
        case 'class':
            return 'class';
        case '12':
        case 'function':
        case 'method':
        case '3':
        case '6':
            return 'function';
        case '11':
        case 'interface':
            return 'interface';
        case '13':
        case '14':
        case 'variable':
        case 'constant':
            return 'variable';
        case '26':
        case 'type':
        case 'typeparameter':
        case '23':
        case 'struct':
            return 'type';
        default:
            return null;
    }
}
