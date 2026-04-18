import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RollbackSnapshotFile {
    path: string;
    existedBefore: boolean;
    content?: string;
}

export interface RollbackPoint {
    id: string;
    sessionId?: string;
    projectRoot: string;
    toolName: string;
    createdAt: Date;
    filePaths: string[];
}

export interface RollbackPointDetails extends RollbackPoint {
    files: RollbackSnapshotFile[];
}

interface PersistedRollbackPoint {
    id: string;
    sessionId?: string;
    projectRoot: string;
    toolName: string;
    createdAt: string;
    files: RollbackSnapshotFile[];
}

export interface RollbackStore {
    createPoint(input: {
        sessionId?: string;
        projectRoot: string;
        toolName: string;
        filePaths: string[];
    }): RollbackPoint;
    restorePoint(id: string): RollbackPoint;
    getPoint(id: string): RollbackPoint | null;
    getPointDetails(id: string): RollbackPointDetails | null;
    listPoints(projectRoot?: string, limit?: number): RollbackPoint[];
}

export class FileRollbackStore implements RollbackStore {
    constructor(private readonly rootDir: string) {
        fs.mkdirSync(this.rootDir, { recursive: true });
    }

    createPoint(input: {
        sessionId?: string;
        projectRoot: string;
        toolName: string;
        filePaths: string[];
    }): RollbackPoint {
        const point = {
            id: createRollbackId(),
            sessionId: input.sessionId,
            projectRoot: path.resolve(input.projectRoot),
            toolName: input.toolName,
            createdAt: new Date(),
            filePaths: uniqueFilePaths(input.filePaths),
        };
        const persisted: PersistedRollbackPoint = {
            id: point.id,
            ...(point.sessionId ? { sessionId: point.sessionId } : {}),
            projectRoot: point.projectRoot,
            toolName: point.toolName,
            createdAt: point.createdAt.toISOString(),
            files: point.filePaths.map((filePath) => snapshotFile(filePath)),
        };

        fs.writeFileSync(
            this.getPointPath(point.id),
            JSON.stringify(persisted, null, 2),
            'utf-8',
        );

        return point;
    }

    restorePoint(id: string): RollbackPoint {
        const persisted = this.readPersistedPoint(id);

        for (const file of persisted.files) {
            if (!file.existedBefore) {
                fs.rmSync(file.path, { force: true });
                continue;
            }

            const dir = path.dirname(file.path);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(file.path, file.content ?? '', 'utf-8');
        }

        return {
            id: persisted.id,
            ...(persisted.sessionId ? { sessionId: persisted.sessionId } : {}),
            projectRoot: persisted.projectRoot,
            toolName: persisted.toolName,
            createdAt: new Date(persisted.createdAt),
            filePaths: persisted.files.map((file) => file.path),
        };
    }

    getPoint(id: string): RollbackPoint | null {
        try {
            const persisted = this.readPersistedPoint(id);
            return toRollbackPoint(persisted);
        } catch {
            return null;
        }
    }

    getPointDetails(id: string): RollbackPointDetails | null {
        try {
            return toRollbackPointDetails(this.readPersistedPoint(id));
        } catch {
            return null;
        }
    }

    listPoints(projectRoot?: string, limit: number = 20): RollbackPoint[] {
        const normalizedProjectRoot = projectRoot ? path.resolve(projectRoot) : undefined;
        const entries = fs.readdirSync(this.rootDir)
            .filter((entry) => entry.endsWith('.json'))
            .map((entry) => this.readPersistedPointSafe(path.join(this.rootDir, entry)))
            .filter((entry): entry is PersistedRollbackPoint => entry !== null)
            .map(toRollbackPoint)
            .filter((point) => !normalizedProjectRoot || point.projectRoot === normalizedProjectRoot)
            .sort(compareRollbackPointsDescending);

        return entries.slice(0, Math.max(1, limit));
    }

    private readPersistedPoint(id: string): PersistedRollbackPoint {
        return this.readPersistedPointFromPath(this.getPointPath(id));
    }

    private getPointPath(id: string): string {
        return path.join(this.rootDir, `${id}.json`);
    }

    private readPersistedPointSafe(filePath: string): PersistedRollbackPoint | null {
        try {
            return this.readPersistedPointFromPath(filePath);
        } catch {
            return null;
        }
    }

    private readPersistedPointFromPath(filePath: string): PersistedRollbackPoint {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Rollback point not found: ${filePath}`);
        }

        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PersistedRollbackPoint;
    }
}

function createRollbackId(): string {
    return `rollback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function snapshotFile(filePath: string): RollbackSnapshotFile {
    if (!fs.existsSync(filePath)) {
        return {
            path: filePath,
            existedBefore: false,
        };
    }

    return {
        path: filePath,
        existedBefore: true,
        content: fs.readFileSync(filePath, 'utf-8'),
    };
}

function uniqueFilePaths(filePaths: string[]): string[] {
    return Array.from(new Set(filePaths.map((filePath) => path.resolve(filePath))));
}

function toRollbackPoint(persisted: PersistedRollbackPoint): RollbackPoint {
    return {
        id: persisted.id,
        ...(persisted.sessionId ? { sessionId: persisted.sessionId } : {}),
        projectRoot: persisted.projectRoot,
        toolName: persisted.toolName,
        createdAt: new Date(persisted.createdAt),
        filePaths: persisted.files.map((file) => file.path),
    };
}

function toRollbackPointDetails(persisted: PersistedRollbackPoint): RollbackPointDetails {
    return {
        ...toRollbackPoint(persisted),
        files: persisted.files.map((file) => ({
            path: file.path,
            existedBefore: file.existedBefore,
            ...(file.content !== undefined ? { content: file.content } : {}),
        })),
    };
}

function compareRollbackPointsDescending(a: RollbackPoint, b: RollbackPoint): number {
    const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
    if (timeDiff !== 0) {
        return timeDiff;
    }

    return b.id.localeCompare(a.id);
}
