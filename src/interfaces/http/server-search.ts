import * as path from 'node:path';
import type { ExternalLanguageServerManager } from '@xqoder/agent';
import {
    decodeSymbolCursor,
    detectSymbolInLine,
    encodeSymbolCursor,
    listProjectFiles,
    readTextFileSafe,
    toResolvedLspSymbolMatch,
    type ResolvedSymbolMatch,
    type ScoredSymbolMatch,
    upsertScoredSymbol,
} from './server-helpers.js';

export interface ProjectContentMatch {
    path: string;
    line: number;
    text: string;
}

export interface ProjectSymbolSearchSuccess {
    ok: true;
    body: {
        query: string;
        kind?: string;
        strategy: {
            lspAttempted: boolean;
            lspSucceeded: boolean;
            fallbackScan: true;
        };
        pagination: {
            cursor: string;
            nextCursor?: string;
            total: number;
        };
        symbols: ResolvedSymbolMatch[];
    };
}

export interface ProjectSymbolSearchError {
    ok: false;
    status: 400;
    body: {
        error: string;
    };
}

export interface FindProjectSymbolsOptions {
    projectRoot: string;
    rawQuery: string;
    kindFilter?: string;
    rawCursor?: string;
    limit?: number;
    lspManager?: Pick<ExternalLanguageServerManager, 'listWorkspaceSymbols'>;
}

export function findProjectFilesByPath(projectRoot: string, rawQuery: string, limit = 50): string[] {
    const query = rawQuery.trim().toLowerCase();
    const normalizedLimit = Math.min(200, Math.max(1, Math.floor(limit) || 50));

    return listProjectFiles(projectRoot, 5000)
        .map((absolutePath) => path.relative(projectRoot, absolutePath))
        .filter((relativePath) => relativePath.toLowerCase().includes(query))
        .slice(0, normalizedLimit);
}

export function searchProjectContent(
    projectRoot: string,
    rawQuery: string,
    options: {
        regex?: boolean;
        limit?: number;
    } = {},
): ProjectContentMatch[] {
    const query = rawQuery.trim();
    const useRegex = options.regex ?? false;
    const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? 50) || 50));
    const matches: ProjectContentMatch[] = [];
    const matcher = useRegex ? new RegExp(query) : null;
    const files = listProjectFiles(projectRoot, 1000);

    for (const absolutePath of files) {
        if (matches.length >= limit) {
            break;
        }

        let content = '';
        try {
            content = readTextFileSafe(absolutePath, 256 * 1024);
        } catch {
            continue;
        }

        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            if (matches.length >= limit) {
                break;
            }
            const line = lines[index] ?? '';
            const matched = matcher ? matcher.test(line) : line.includes(query);
            if (!matched) {
                continue;
            }
            matches.push({
                path: path.relative(projectRoot, absolutePath),
                line: index + 1,
                text: line,
            });
        }
    }

    return matches;
}

export async function findProjectSymbols(
    options: FindProjectSymbolsOptions,
): Promise<ProjectSymbolSearchSuccess | ProjectSymbolSearchError> {
    const query = options.rawQuery.toLowerCase();
    const kindFilter = (options.kindFilter ?? '').trim().toLowerCase();
    const rawCursor = (options.rawCursor ?? '').trim();
    const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? 50) || 50));
    const symbolBucket = new Map<string, ScoredSymbolMatch>();
    let lspAttempted = false;
    let lspSucceeded = false;

    let offset = 0;
    if (rawCursor) {
        const cursor = decodeSymbolCursor(rawCursor);
        if (!cursor) {
            return {
                ok: false,
                status: 400,
                body: {
                    error: 'Invalid cursor',
                },
            };
        }
        if (cursor.query !== options.rawQuery || (cursor.kind ?? '') !== kindFilter) {
            return {
                ok: false,
                status: 400,
                body: {
                    error: 'Cursor does not match query/kind',
                },
            };
        }
        offset = cursor.offset;
    }

    if (options.lspManager) {
        lspAttempted = true;
        try {
            const lspMatches = await options.lspManager.listWorkspaceSymbols(options.rawQuery, limit * 2);
            lspSucceeded = true;
            for (const lspMatch of lspMatches) {
                const normalized = toResolvedLspSymbolMatch(lspMatch, options.projectRoot);
                if (!normalized) {
                    continue;
                }
                if (!normalized.name.toLowerCase().includes(query)) {
                    continue;
                }
                if (kindFilter && normalized.kind !== kindFilter) {
                    continue;
                }
                upsertScoredSymbol(symbolBucket, query, normalized);
            }
        } catch {
            // graceful fallback to scan-based implementation
        }
    }

    const files = listProjectFiles(options.projectRoot, 10000)
        .filter((absolutePath) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|swift|rs|cpp|cc|c|h|hpp)$/i.test(absolutePath));

    for (const absolutePath of files) {
        let content = '';
        try {
            content = readTextFileSafe(absolutePath, 256 * 1024);
        } catch {
            continue;
        }

        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? '';
            const symbol = detectSymbolInLine(line);
            if (!symbol) {
                continue;
            }
            if (!symbol.name.toLowerCase().includes(query)) {
                continue;
            }
            if (kindFilter && kindFilter !== symbol.kind) {
                continue;
            }

            upsertScoredSymbol(symbolBucket, query, {
                name: symbol.name,
                kind: symbol.kind,
                path: path.relative(options.projectRoot, absolutePath),
                line: index + 1,
                text: line,
                source: 'scan',
            });
        }
    }

    const matches = Array.from(symbolBucket.values())
        .sort((left, right) => {
            if (left.score !== right.score) {
                return right.score - left.score;
            }
            if (left.value.source !== right.value.source) {
                return left.value.source === 'lsp' ? -1 : 1;
            }
            if (left.value.path !== right.value.path) {
                return left.value.path.localeCompare(right.value.path);
            }
            return left.value.line - right.value.line;
        })
        .map((entry) => entry.value);

    const paged = matches.slice(offset, offset + limit);
    const nextOffset = offset + paged.length;
    const nextCursor = nextOffset < matches.length
        ? encodeSymbolCursor({
            query: options.rawQuery,
            ...(kindFilter ? { kind: kindFilter } : {}),
            offset: nextOffset,
        })
        : undefined;

    return {
        ok: true,
        body: {
            query: options.rawQuery,
            ...(kindFilter ? { kind: kindFilter } : {}),
            strategy: {
                lspAttempted,
                lspSucceeded,
                fallbackScan: true as const,
            },
            pagination: {
                cursor: rawCursor || '',
                total: matches.length,
                ...(nextCursor ? { nextCursor } : {}),
            },
            symbols: paged,
        },
    };
}
