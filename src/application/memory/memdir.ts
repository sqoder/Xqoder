import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const MAX_MEMORY_FILE_CHARS = 4_000;
const MAX_RELEVANT_MEMORIES = 3;
const MIN_TOKEN_OVERLAP = 1;

export type MemorySource = 'project' | 'user' | 'memdir';

export interface MemoryFile {
    filePath: string;
    source: MemorySource;
    content: string;
}

export interface MemoryBlock {
    filePath: string;
    source: MemorySource;
    content: string;
    score: number;
}

export interface ScanMemoryFilesOptions {
    cwd: string;
    homeDir?: string;
}

const PROJECT_CANDIDATES = [
    'CLAUDE.md',
    'CLAUDE.local.md',
    'xqoder.md',
    'xqoder.local.md',
    '.claude/CLAUDE.md',
    '.xqoder/CLAUDE.md',
];

export function scanMemoryFiles(options: ScanMemoryFilesOptions): MemoryFile[] {
    const out: MemoryFile[] = [];
    const seen = new Set<string>();

    for (const candidate of PROJECT_CANDIDATES) {
        const abs = path.resolve(options.cwd, candidate);
        pushIfReadable(abs, 'project', out, seen);
    }

    const memdir = path.resolve(options.cwd, 'memdir');
    if (isDirectory(memdir)) {
        for (const entry of safeReaddir(memdir)) {
            if (!entry.endsWith('.md')) continue;
            pushIfReadable(path.join(memdir, entry), 'memdir', out, seen);
        }
    }

    const home = options.homeDir ?? os.homedir();
    const userCandidates = [
        path.join(home, '.xqoder', 'CLAUDE.md'),
        path.join(home, '.xqoder', 'memdir'),
    ];
    pushIfReadable(userCandidates[0]!, 'user', out, seen);

    if (isDirectory(userCandidates[1]!)) {
        for (const entry of safeReaddir(userCandidates[1]!)) {
            if (!entry.endsWith('.md')) continue;
            pushIfReadable(path.join(userCandidates[1]!, entry), 'user', out, seen);
        }
    }

    return out;
}

export function findRelevantMemories(
    files: readonly MemoryFile[],
    prompt: string,
    limit: number = MAX_RELEVANT_MEMORIES,
): MemoryBlock[] {
    const promptTokens = tokenize(prompt);
    if (promptTokens.size === 0) {
        return [];
    }

    const scored: MemoryBlock[] = [];
    for (const file of files) {
        const fileTokens = tokenize(file.content);
        let overlap = 0;
        for (const token of promptTokens) {
            if (fileTokens.has(token)) {
                overlap += 1;
            }
        }
        if (overlap < MIN_TOKEN_OVERLAP) {
            continue;
        }
        scored.push({
            filePath: file.filePath,
            source: file.source,
            content: file.content,
            score: overlap,
        });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
}

export interface LoadMemdirContextOptions {
    cwd: string;
    sessionId: string;
    prompt: string;
    homeDir?: string;
}

export interface LoadMemdirContextResult {
    memories: MemoryBlock[];
}

export async function loadMemdirContext(
    options: LoadMemdirContextOptions,
): Promise<LoadMemdirContextResult> {
    return loadMemdirContextSync(options);
}

export function loadMemdirContextSync(options: LoadMemdirContextOptions): LoadMemdirContextResult {
    if (process.env.XQODER_DISABLE_MEMDIR === '1') {
        return { memories: [] };
    }
    const files = scanMemoryFiles({
        cwd: options.cwd,
        ...(options.homeDir ? { homeDir: options.homeDir } : {}),
    });
    return { memories: findRelevantMemories(files, options.prompt) };
}

function pushIfReadable(
    absPath: string,
    source: MemorySource,
    out: MemoryFile[],
    seen: Set<string>,
): void {
    if (seen.has(absPath)) return;
    seen.add(absPath);
    try {
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) return;
        const raw = fs.readFileSync(absPath, 'utf-8').trim();
        if (!raw) return;
        const content = raw.length > MAX_MEMORY_FILE_CHARS
            ? `${raw.slice(0, MAX_MEMORY_FILE_CHARS)}...`
            : raw;
        out.push({ filePath: absPath, source, content });
    } catch {
        // ignore unreadable files
    }
}

function isDirectory(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function safeReaddir(dir: string): string[] {
    try {
        return fs.readdirSync(dir).sort();
    } catch {
        return [];
    }
}

const TOKEN_RE = /[A-Za-z][A-Za-z0-9_-]{2,}/g;
const STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'about',
    'please', 'help', 'check', 'look', 'show', 'give', 'tell', 'make',
    'been', 'have', 'your', 'will', 'their', 'them', 'what', 'which',
    'when', 'where', 'why', 'how', 'can', 'should', 'would', 'could',
]);

function tokenize(text: string): Set<string> {
    const tokens = new Set<string>();
    for (const match of text.toLowerCase().matchAll(TOKEN_RE)) {
        const token = match[0];
        if (!token || STOPWORDS.has(token)) continue;
        tokens.add(token);
    }
    return tokens;
}
