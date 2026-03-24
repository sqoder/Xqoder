import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SessionReference {
    target?: string;
}

export interface SymbolReference {
    query: string;
}

export interface ExtractContextReferencesResult {
    text: string;
    sessionReferences: SessionReference[];
    symbolReferences: SymbolReference[];
}

export interface SymbolMatch {
    path: string;
    line: number;
    content: string;
}

const TRAILING_PUNCTUATION_RE = /[),.;:!?\]\}]+$/;
const SESSION_REFERENCE_RE = /(^|[\s(])@session(?:[:]([\w-]+))?/g;
const SYMBOL_REFERENCE_RE = /(^|[\s(])@symbol:(?:"([^"\n]+)"|'([^'\n]+)'|([^\s'"`]+))/g;
const SKIP_DIRS = new Set(['.git', '.xqoder', '.idea', '.vscode', 'node_modules', 'dist', 'build', 'coverage']);
const TEXT_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json',
    '.py', '.go', '.java', '.kt', '.rs', '.cpp', '.c', '.h', '.hpp',
    '.cs', '.php', '.rb', '.swift', '.scala', '.sql', '.yaml', '.yml',
    '.toml', '.md', '.txt', '.html', '.css', '.scss', '.xml', '.sh',
]);

function normalizeCandidate(input: string): string {
    return input.trim().replace(TRAILING_PUNCTUATION_RE, '');
}

function normalizePromptText(value: string, fallback: string): string {
    const normalized = value
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .trim();
    return normalized.length > 0 ? normalized : fallback.trim();
}

export function extractContextReferencesFromPrompt(text: string): ExtractContextReferencesResult {
    const sessionReferences: SessionReference[] = [];
    const symbolReferences: SymbolReference[] = [];

    const withoutSessions = text.replace(SESSION_REFERENCE_RE, (_full, prefix: string, rawTarget: string | undefined) => {
        sessionReferences.push({ target: rawTarget?.trim() });
        return prefix;
    });

    const withoutSymbols = withoutSessions.replace(
        SYMBOL_REFERENCE_RE,
        (_full, prefix: string, q1: string | undefined, q2: string | undefined, q3: string | undefined) => {
            const query = normalizeCandidate(q1 ?? q2 ?? q3 ?? '');
            if (!query) {
                return `${prefix}@symbol:`;
            }
            symbolReferences.push({ query });
            return prefix;
        },
    );

    return {
        text: normalizePromptText(withoutSymbols, text),
        sessionReferences,
        symbolReferences,
    };
}

function isLikelyTextFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return TEXT_EXTENSIONS.has(ext);
}

export function scanSymbolMatches(cwd: string, rawQuery: string, limit = 6): SymbolMatch[] {
    const query = rawQuery.trim();
    if (!query) {
        return [];
    }

    const results: SymbolMatch[] = [];
    const loweredQuery = query.toLowerCase();

    const walk = (currentDir: string, depth: number): void => {
        if (depth > 4 || results.length >= limit) {
            return;
        }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (results.length >= limit) {
                return;
            }

            if (entry.name.startsWith('.') && entry.name !== '.env') {
                continue;
            }
            if (SKIP_DIRS.has(entry.name)) {
                continue;
            }

            const absolutePath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                walk(absolutePath, depth + 1);
                continue;
            }

            if (!entry.isFile() || !isLikelyTextFile(absolutePath)) {
                continue;
            }

            let content: string;
            try {
                content = fs.readFileSync(absolutePath, 'utf8');
            } catch {
                continue;
            }

            const lines = content.split(/\r?\n/);
            for (let index = 0; index < lines.length; index += 1) {
                if (results.length >= limit) {
                    return;
                }
                const line = lines[index] ?? '';
                if (!line.toLowerCase().includes(loweredQuery)) {
                    continue;
                }
                const trimmed = line.trim();
                if (!trimmed) {
                    continue;
                }
                results.push({
                    path: absolutePath,
                    line: index + 1,
                    content: trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed,
                });
            }
        }
    };

    walk(path.resolve(cwd), 0);
    return results;
}
