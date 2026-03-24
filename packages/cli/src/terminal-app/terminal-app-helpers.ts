import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

type CompleteFrecencyStats = {
    hits: number;
    lastUsedTick: number;
};

const completeFrecency = new Map<string, CompleteFrecencyStats>();
let completeFrecencyTick = 0;

export function inferAttachmentKind(filePath: string): 'file' | 'image' | 'text' {
    const ext = path.extname(filePath).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        return 'image';
    }
    return 'file';
}

export function formatAttachmentLabel(filePath: string): string {
    const fileName = path.basename(filePath);
    return fileName.length > 18 ? `${fileName.slice(0, 15)}...` : fileName;
}

export function loadFilepickerEntries(dir: string): Array<{ path: string; label: string; isDir: boolean }> {
    const entries: Array<{ path: string; label: string; isDir: boolean }> = [];
    const resolvedDir = path.resolve(dir);
    const parent = path.dirname(resolvedDir);
    if (parent !== resolvedDir) {
        entries.push({ path: parent, label: '..', isDir: true });
    }
    try {
        const items = fs.readdirSync(resolvedDir, { withFileTypes: true });
        const list = items
            .filter((item) => {
                if (item.name.startsWith('.')) return false;
                if (item.name === 'node_modules' || item.name === 'dist') return false;
                return true;
            })
            .map((item) => ({
                path: path.join(resolvedDir, item.name),
                label: item.name + (item.isDirectory() ? '/' : ''),
                isDir: item.isDirectory(),
            }))
            .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.label.localeCompare(b.label)));
        entries.push(...list);
    } catch {
        // leave only ..
    }
    return entries;
}

export function resolveFilepickerInputPath(currentDir: string, rawInput: string): string {
    const trimmed = rawInput.trim();
    if (!trimmed) {
        return currentDir;
    }
    if (trimmed === '~') {
        return os.homedir();
    }
    if (trimmed.startsWith('~/')) {
        return path.join(os.homedir(), trimmed.slice(2));
    }
    if (path.isAbsolute(trimmed)) {
        return path.normalize(trimmed);
    }
    return path.resolve(currentDir, trimmed);
}

export function loadCompleteSearchEntries(rootDir: string, query: string, maxResults = 120): Array<{ path: string; label: string; isDir: boolean }> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        const base = loadFilepickerEntries(rootDir);
        return sortCompleteEntriesByFrecency(base, normalizedQuery).slice(0, maxResults);
    }

    const results: Array<{ path: string; label: string; isDir: boolean }> = [];
    const maxDepth = 4;

    const pushEntry = (targetPath: string, relLabel: string, isDir: boolean): void => {
        if (results.length >= maxResults) {
            return;
        }
        const label = isDir ? `${relLabel}/` : relLabel;
        results.push({ path: targetPath, label, isDir });
    };

    const walk = (dir: string, depth: number): void => {
        if (depth > maxDepth || results.length >= maxResults) {
            return;
        }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (results.length >= maxResults) {
                return;
            }
            if (entry.name.startsWith('.')) {
                continue;
            }
            if (entry.name === 'node_modules' || entry.name === 'dist') {
                continue;
            }

            const targetPath = path.join(dir, entry.name);
            const rel = path.relative(rootDir, targetPath);
            const relUnix = rel.split(path.sep).join('/');
            const haystack = `${entry.name.toLowerCase()} ${relUnix.toLowerCase()}`;

            if (haystack.includes(normalizedQuery)) {
                pushEntry(targetPath, relUnix, entry.isDirectory());
            }

            if (entry.isDirectory()) {
                walk(targetPath, depth + 1);
            }
        }
    };

    walk(path.resolve(rootDir), 0);
    return sortCompleteEntriesByFrecency(results, normalizedQuery);
}

function scoreQueryMatch(entry: { label: string; path: string }, normalizedQuery: string): number {
    if (!normalizedQuery) {
        return 0;
    }
    const labelLower = entry.label.toLowerCase();
    const fileNameLower = path.basename(entry.path).toLowerCase();
    const pathLower = entry.path.toLowerCase();
    if (fileNameLower === normalizedQuery) return 600;
    if (labelLower === normalizedQuery) return 560;
    if (fileNameLower.startsWith(normalizedQuery)) return 420;
    if (labelLower.startsWith(normalizedQuery)) return 360;
    if (pathLower.includes(`/${normalizedQuery}`) || pathLower.includes(`\\${normalizedQuery}`)) return 220;
    if (labelLower.includes(normalizedQuery)) return 180;
    return 120;
}

function scoreFrecency(entryPath: string): number {
    const stats = completeFrecency.get(entryPath);
    if (!stats) {
        return 0;
    }
    const age = Math.max(0, completeFrecencyTick - stats.lastUsedTick);
    const recency = Math.max(0, 80 - age * 2);
    return stats.hits * 40 + recency;
}

function sortCompleteEntriesByFrecency(
    entries: Array<{ path: string; label: string; isDir: boolean }>,
    normalizedQuery: string,
): Array<{ path: string; label: string; isDir: boolean }> {
    return [...entries].sort((a, b) => {
        const scoreA = scoreQueryMatch(a, normalizedQuery) + scoreFrecency(a.path);
        const scoreB = scoreQueryMatch(b, normalizedQuery) + scoreFrecency(b.path);
        if (scoreA !== scoreB) {
            return scoreB - scoreA;
        }
        if (a.isDir !== b.isDir) {
            return a.isDir ? -1 : 1;
        }
        return a.label.localeCompare(b.label);
    });
}

export function recordCompleteSelection(selectedPath: string): void {
    const normalized = path.resolve(selectedPath);
    completeFrecencyTick += 1;
    const current = completeFrecency.get(normalized);
    if (!current) {
        completeFrecency.set(normalized, { hits: 1, lastUsedTick: completeFrecencyTick });
        return;
    }
    completeFrecency.set(normalized, {
        hits: current.hits + 1,
        lastUsedTick: completeFrecencyTick,
    });
}

export function __resetCompleteFrecencyForTest(): void {
    completeFrecency.clear();
    completeFrecencyTick = 0;
}

export function parsePatchedPathFromLine(line: string): string | undefined {
    const trimmed = line.trim();
    if (!trimmed) return undefined;

    const single = trimmed.match(/^Patched\s+(.+?)\s+\(\+\d+\s+-\d+\)$/);
    if (single?.[1]) {
        const candidate = single[1].trim();
        if (!/^\d+\s+files?$/.test(candidate)) {
            return candidate;
        }
    }

    const bullet = trimmed.match(/^(?:[-*•])\s+(.+)$/);
    if (bullet?.[1]) {
        return bullet[1].trim();
    }

    return undefined;
}

const INIT_FLAG_FILE = 'init';

export function hasInitFlag(projectDir: string): boolean {
    const flagPath = path.join(projectDir, '.xqoder', INIT_FLAG_FILE);
    return fs.existsSync(flagPath);
}

export function markProjectInitialized(projectDir: string): void {
    const dotXqoder = path.join(projectDir, '.xqoder');
    const flagPath = path.join(dotXqoder, INIT_FLAG_FILE);
    if (!fs.existsSync(dotXqoder)) {
        fs.mkdirSync(dotXqoder, { recursive: true });
    }
    fs.writeFileSync(flagPath, '', 'utf-8');
}
