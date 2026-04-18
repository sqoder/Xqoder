// ============================================================
// LSP File Watcher — Listen for file changes and notify LSP servers
// Reference OpenCode: internal/lsp/watcher/watcher.go
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExternalLanguageServerManager } from './lsp.js';

const DEFAULT_IGNORE = [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '__pycache__',
    '.cache',
    'coverage',
    '.turbo',
];

const DEBOUNCE_MS = 300;

export interface LspWatcherOptions {
    projectRoot: string;
    lspManager: ExternalLanguageServerManager;
    ignore?: string[];
    onFileChanged?: (filePath: string) => void;
}

/**
 * LspFileWatcher watches for file changes in the project and notifies LSP servers.
 * Uses `fs.watch` (recursive where supported) with debouncing.
 */
export class LspFileWatcher {
    private watchers: fs.FSWatcher[] = [];
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private ignore: Set<string>;
    private projectRoot: string;
    private lspManager: ExternalLanguageServerManager;
    private disposed = false;
    private onFileChanged?: (filePath: string) => void;

    constructor(options: LspWatcherOptions) {
        this.projectRoot = options.projectRoot;
        this.lspManager = options.lspManager;
        this.ignore = new Set([...DEFAULT_IGNORE, ...(options.ignore ?? [])]);
        this.onFileChanged = options.onFileChanged;
    }

    start(): void {
        if (this.disposed) return;

        try {
            const watcher = fs.watch(
                this.projectRoot,
                { recursive: true },
                (eventType, filename) => {
                    if (!filename) return;
                    this.handleChange(eventType, filename);
                },
            );
            this.watchers.push(watcher);
        } catch {
            // Recursive watch not supported on all platforms; fall back to top-level
            this.watchDirectory(this.projectRoot, 0);
        }
    }

    stop(): void {
        this.disposed = true;
        for (const watcher of this.watchers) {
            try { watcher.close(); } catch { /* ignore */ }
        }
        this.watchers = [];
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
    }

    private watchDirectory(dir: string, depth: number): void {
        if (depth > 3 || this.disposed) return;

        try {
            const watcher = fs.watch(dir, (eventType, filename) => {
                if (!filename) return;
                const rel = path.relative(this.projectRoot, path.join(dir, filename));
                this.handleChange(eventType, rel);
            });
            this.watchers.push(watcher);

            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !this.ignore.has(entry.name) && !entry.name.startsWith('.')) {
                    this.watchDirectory(path.join(dir, entry.name), depth + 1);
                }
            }
        } catch { /* ignore permission errors etc. */ }
    }

    private handleChange(eventType: string, filename: string): void {
        const segments = filename.split(path.sep);
        for (const seg of segments) {
            if (this.ignore.has(seg) || seg.startsWith('.')) return;
        }

        // Debounce rapid changes to the same file
        const existing = this.debounceTimers.get(filename);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(filename, setTimeout(() => {
            this.debounceTimers.delete(filename);
            this.notifyChange(filename, eventType);
        }, DEBOUNCE_MS));
    }

    private notifyChange(filename: string, _eventType: string): void {
        const fullPath = path.join(this.projectRoot, filename);

        try {
            this.lspManager.notifyFileChanged?.(fullPath);
        } catch { /* ignore */ }

        this.onFileChanged?.(fullPath);
    }
}
