// ============================================================
// File History — File version tracking service
// Reference: internal/history/file.go
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export interface FileVersion {
    path: string;
    version: number;
    content: string;
    hash: string;
    sessionId: string;
    createdAt: Date;
}

export interface FileHistoryStore {
    saveVersion(filePath: string, content: string, sessionId: string): FileVersion;
    getVersion(filePath: string, version: number): FileVersion | undefined;
    getLatest(filePath: string): FileVersion | undefined;
    listVersions(filePath: string): FileVersion[];
    listSessionFiles(sessionId: string): string[];
}

/**
 * In-memory file history store that also persists to disk.
 * Stores file versions in a directory structure:
 *   <baseDir>/<hash-of-path>/<version>.txt
 */
export class DiskFileHistoryStore implements FileHistoryStore {
    private versions = new Map<string, FileVersion[]>();
    private sessionFiles = new Map<string, Set<string>>();

    constructor(private baseDir: string) {
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }
    }

    saveVersion(filePath: string, content: string, sessionId: string): FileVersion {
        const normalizedPath = path.resolve(filePath);
        const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);

        const existing = this.versions.get(normalizedPath) ?? [];
        const latestVersion = existing.length > 0 ? existing[existing.length - 1]!.version : 0;

        // Skip if content hasn't changed
        if (existing.length > 0 && existing[existing.length - 1]!.hash === hash) {
            return existing[existing.length - 1]!;
        }

        const version: FileVersion = {
            path: normalizedPath,
            version: latestVersion + 1,
            content,
            hash,
            sessionId,
            createdAt: new Date(),
        };

        existing.push(version);
        this.versions.set(normalizedPath, existing);

        // Track session files
        if (!this.sessionFiles.has(sessionId)) {
            this.sessionFiles.set(sessionId, new Set());
        }
        this.sessionFiles.get(sessionId)!.add(normalizedPath);

        // Persist to disk
        this.persistVersion(version);

        return version;
    }

    getVersion(filePath: string, version: number): FileVersion | undefined {
        const normalizedPath = path.resolve(filePath);
        const versions = this.versions.get(normalizedPath);
        return versions?.find(v => v.version === version);
    }

    getLatest(filePath: string): FileVersion | undefined {
        const normalizedPath = path.resolve(filePath);
        const versions = this.versions.get(normalizedPath);
        return versions?.[versions.length - 1];
    }

    listVersions(filePath: string): FileVersion[] {
        const normalizedPath = path.resolve(filePath);
        return this.versions.get(normalizedPath) ?? [];
    }

    listSessionFiles(sessionId: string): string[] {
        return Array.from(this.sessionFiles.get(sessionId) ?? []);
    }

    private persistVersion(version: FileVersion): void {
        try {
            const pathHash = crypto.createHash('md5').update(version.path).digest('hex').slice(0, 12);
            const dir = path.join(this.baseDir, pathHash);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const metaFile = path.join(dir, 'meta.json');
            let meta: { path: string; versions: number[] } = { path: version.path, versions: [] };
            if (fs.existsSync(metaFile)) {
                try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8')); } catch { /* ignore */ }
            }
            meta.versions.push(version.version);
            fs.writeFileSync(metaFile, JSON.stringify(meta), 'utf-8');

            const versionFile = path.join(dir, `v${version.version}.txt`);
            fs.writeFileSync(versionFile, version.content, 'utf-8');
        } catch { /* ignore disk errors */ }
    }
}
