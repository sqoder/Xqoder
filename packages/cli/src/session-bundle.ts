import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PersistedSessionSummary } from '@xqoder/agent';
import type { AgentSession, RollbackPointDetails, RollbackStore } from '@xqoder/agent';
import {
    createSessionExportDocument,
    parseSessionExportDocument,
    type SessionExportDocument,
} from './session-assets.js';

export interface SessionReplayBundleWorkspaceChange {
    relativePath: string;
    lastChangeType: 'write' | 'patch' | 'restore';
    changeCount: number;
    lastUpdatedAt: string;
    finalExists: boolean;
    finalContent?: string;
    rollbackPointIds: string[];
}

export interface SessionReplayBundleRollbackPointFile {
    relativePath: string;
    existedBefore: boolean;
    content?: string;
}

export interface SessionReplayBundleRollbackPoint {
    id: string;
    toolName: string;
    createdAt: string;
    files: SessionReplayBundleRollbackPointFile[];
}

export interface SessionReplayBundleSkippedPath {
    path: string;
    reason: 'outside_project_root' | 'read_failed';
}

export interface SessionReplayBundleDocument extends SessionExportDocument {
    artifactKind: 'xqoder-bundle';
    bundleVersion: 1;
    workspaceChanges: SessionReplayBundleWorkspaceChange[];
    rollbackPoints: SessionReplayBundleRollbackPoint[];
    skippedPaths: SessionReplayBundleSkippedPath[];
}

export interface ApplySessionReplayBundleResult {
    appliedFiles: number;
    deletedFiles: number;
}

export function createSessionReplayBundleDocument(input: {
    summary: PersistedSessionSummary;
    session: AgentSession;
    rollbackStore?: Pick<RollbackStore, 'listPoints' | 'getPointDetails'>;
}): SessionReplayBundleDocument {
    const projectRoot = path.resolve(input.summary.projectRoot);
    const baseDocument = createSessionExportDocument(input.summary, input.session);
    const skippedPaths: SessionReplayBundleSkippedPath[] = [];
    const rollbackPoints = collectReplayRollbackPoints(
        projectRoot,
        input.summary.id,
        input.rollbackStore,
        skippedPaths,
    );
    const rollbackIndex = buildRollbackPointIndex(rollbackPoints);
    const workspaceChanges = collectWorkspaceChanges(
        projectRoot,
        input.session.getFileChanges(),
        rollbackIndex,
        skippedPaths,
    );

    return {
        ...baseDocument,
        artifactKind: 'xqoder-bundle',
        bundleVersion: 1,
        workspaceChanges,
        rollbackPoints,
        skippedPaths,
    };
}

export function isSessionReplayBundleDocument(value: unknown): value is SessionReplayBundleDocument {
    return Boolean(
        value
        && typeof value === 'object'
        && (value as { artifactKind?: unknown }).artifactKind === 'xqoder-bundle'
        && Array.isArray((value as { workspaceChanges?: unknown[] }).workspaceChanges)
        && Array.isArray((value as { rollbackPoints?: unknown[] }).rollbackPoints),
    );
}

export function parseSessionReplayBundleDocument(value: unknown): SessionReplayBundleDocument {
    const baseDocument = parseSessionExportDocument(value);
    const source = value && typeof value === 'object'
        ? value as Partial<SessionReplayBundleDocument>
        : {};

    return {
        ...baseDocument,
        artifactKind: 'xqoder-bundle',
        bundleVersion: 1,
        workspaceChanges: normalizeWorkspaceChanges(source.workspaceChanges),
        rollbackPoints: normalizeRollbackPoints(source.rollbackPoints),
        skippedPaths: normalizeSkippedPaths(source.skippedPaths),
    };
}

export function applySessionReplayBundle(
    bundle: SessionReplayBundleDocument,
    projectRoot: string,
): ApplySessionReplayBundleResult {
    const normalizedRoot = path.resolve(projectRoot);
    let appliedFiles = 0;
    let deletedFiles = 0;

    for (const change of bundle.workspaceChanges) {
        const targetPath = resolveBundleTargetPath(normalizedRoot, change.relativePath);
        if (change.finalExists) {
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, change.finalContent ?? '', 'utf8');
            appliedFiles += 1;
            continue;
        }

        fs.rmSync(targetPath, { force: true });
        deletedFiles += 1;
    }

    return { appliedFiles, deletedFiles };
}

function collectReplayRollbackPoints(
    projectRoot: string,
    sessionId: string,
    rollbackStore: Pick<RollbackStore, 'listPoints' | 'getPointDetails'> | undefined,
    skippedPaths: SessionReplayBundleSkippedPath[],
): SessionReplayBundleRollbackPoint[] {
    if (!rollbackStore) {
        return [];
    }

    return rollbackStore
        .listPoints(projectRoot, 1000)
        .filter((point) => point.sessionId === sessionId)
        .map((point) => rollbackStore.getPointDetails(point.id))
        .filter((point): point is RollbackPointDetails => point !== null)
        .map((point) => toReplayRollbackPoint(projectRoot, point, skippedPaths))
        .filter((point): point is SessionReplayBundleRollbackPoint => point !== null)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function toReplayRollbackPoint(
    projectRoot: string,
    point: RollbackPointDetails,
    skippedPaths: SessionReplayBundleSkippedPath[],
): SessionReplayBundleRollbackPoint | null {
    const files = point.files
        .map((file) => {
            const relativePath = toProjectRelativePath(projectRoot, file.path);
            if (!relativePath) {
                skippedPaths.push({ path: file.path, reason: 'outside_project_root' });
                return null;
            }
            return {
                relativePath,
                existedBefore: file.existedBefore,
                ...(file.content !== undefined ? { content: file.content } : {}),
            };
        })
        .filter((file): file is SessionReplayBundleRollbackPointFile => file !== null);

    if (files.length === 0) {
        return null;
    }

    return {
        id: point.id,
        toolName: point.toolName,
        createdAt: point.createdAt.toISOString(),
        files,
    };
}

function buildRollbackPointIndex(
    rollbackPoints: SessionReplayBundleRollbackPoint[],
): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const point of rollbackPoints) {
        for (const file of point.files) {
            const existing = index.get(file.relativePath) ?? [];
            existing.push(point.id);
            index.set(file.relativePath, existing);
        }
    }
    return index;
}

function collectWorkspaceChanges(
    projectRoot: string,
    fileChanges: ReturnType<AgentSession['getFileChanges']>,
    rollbackIndex: Map<string, string[]>,
    skippedPaths: SessionReplayBundleSkippedPath[],
): SessionReplayBundleWorkspaceChange[] {
    const byPath = new Map<string, {
        lastChangeType: 'write' | 'patch' | 'restore';
        changeCount: number;
        lastUpdatedAt: string;
    }>();

    for (const change of fileChanges) {
        const relativePath = toProjectRelativePath(projectRoot, change.path);
        if (!relativePath) {
            skippedPaths.push({ path: change.path, reason: 'outside_project_root' });
            continue;
        }

        const previous = byPath.get(relativePath);
        const timestamp = change.timestamp.toISOString();
        byPath.set(relativePath, {
            lastChangeType: change.changeType,
            changeCount: (previous?.changeCount ?? 0) + 1,
            lastUpdatedAt: previous && previous.lastUpdatedAt > timestamp
                ? previous.lastUpdatedAt
                : timestamp,
        });
    }

    return [...byPath.entries()]
        .map(([relativePath, entry]) => {
            const absolutePath = resolveBundleTargetPath(projectRoot, relativePath);
            try {
                const finalExists = fs.existsSync(absolutePath);
                return {
                    relativePath,
                    lastChangeType: entry.lastChangeType,
                    changeCount: entry.changeCount,
                    lastUpdatedAt: entry.lastUpdatedAt,
                    finalExists,
                    ...(finalExists ? { finalContent: fs.readFileSync(absolutePath, 'utf8') } : {}),
                    rollbackPointIds: [...(rollbackIndex.get(relativePath) ?? [])],
                } satisfies SessionReplayBundleWorkspaceChange;
            } catch {
                skippedPaths.push({ path: absolutePath, reason: 'read_failed' });
                return null;
            }
        })
        .filter((entry): entry is SessionReplayBundleWorkspaceChange => entry !== null)
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function normalizeWorkspaceChanges(value: unknown): SessionReplayBundleWorkspaceChange[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => normalizeWorkspaceChange(entry))
        .filter((entry): entry is SessionReplayBundleWorkspaceChange => entry !== null);
}

function normalizeWorkspaceChange(value: unknown): SessionReplayBundleWorkspaceChange | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const entry = value as Partial<SessionReplayBundleWorkspaceChange>;
    const relativePath = readString(entry.relativePath);
    const lastUpdatedAt = readString(entry.lastUpdatedAt);
    if (!relativePath || !lastUpdatedAt || !isFileChangeType(entry.lastChangeType)) {
        return null;
    }

    return {
        relativePath,
        lastChangeType: entry.lastChangeType,
        changeCount: readPositiveInteger(entry.changeCount) ?? 1,
        lastUpdatedAt,
        finalExists: Boolean(entry.finalExists),
        ...(Boolean(entry.finalExists) && typeof entry.finalContent === 'string' ? { finalContent: entry.finalContent } : {}),
        rollbackPointIds: Array.isArray(entry.rollbackPointIds)
            ? entry.rollbackPointIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
            : [],
    };
}

function normalizeRollbackPoints(value: unknown): SessionReplayBundleRollbackPoint[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => normalizeRollbackPoint(entry))
        .filter((entry): entry is SessionReplayBundleRollbackPoint => entry !== null);
}

function normalizeRollbackPoint(value: unknown): SessionReplayBundleRollbackPoint | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const entry = value as Partial<SessionReplayBundleRollbackPoint>;
    const id = readString(entry.id);
    const toolName = readString(entry.toolName);
    const createdAt = readString(entry.createdAt);
    if (!id || !toolName || !createdAt || !Array.isArray(entry.files)) {
        return null;
    }

    const files = entry.files
        .map((file) => normalizeRollbackPointFile(file))
        .filter((file): file is SessionReplayBundleRollbackPointFile => file !== null);
    if (files.length === 0) {
        return null;
    }

    return { id, toolName, createdAt, files };
}

function normalizeRollbackPointFile(value: unknown): SessionReplayBundleRollbackPointFile | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const entry = value as Partial<SessionReplayBundleRollbackPointFile>;
    const relativePath = readString(entry.relativePath);
    if (!relativePath) {
        return null;
    }

    return {
        relativePath,
        existedBefore: Boolean(entry.existedBefore),
        ...(typeof entry.content === 'string' ? { content: entry.content } : {}),
    };
}

function normalizeSkippedPaths(value: unknown): SessionReplayBundleSkippedPath[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => normalizeSkippedPath(entry))
        .filter((entry): entry is SessionReplayBundleSkippedPath => entry !== null);
}

function normalizeSkippedPath(value: unknown): SessionReplayBundleSkippedPath | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const entry = value as Partial<SessionReplayBundleSkippedPath>;
    const filePath = readString(entry.path);
    const reason = entry.reason === 'outside_project_root' || entry.reason === 'read_failed'
        ? entry.reason
        : undefined;
    if (!filePath || !reason) {
        return null;
    }

    return { path: filePath, reason };
}

function resolveBundleTargetPath(projectRoot: string, relativePath: string): string {
    const normalizedRoot = path.resolve(projectRoot);
    const targetPath = path.resolve(normalizedRoot, relativePath);
    const relative = path.relative(normalizedRoot, targetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`bundle path escapes project root: ${relativePath}`);
    }
    return targetPath;
}

function toProjectRelativePath(projectRoot: string, filePath: string): string | null {
    const normalizedRoot = path.resolve(projectRoot);
    const resolvedPath = path.resolve(filePath);
    const relativePath = path.relative(normalizedRoot, resolvedPath);
    if (relativePath.length === 0 || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return null;
    }
    return relativePath.split(path.sep).join('/');
}

function isFileChangeType(value: unknown): value is SessionReplayBundleWorkspaceChange['lastChangeType'] {
    return value === 'write' || value === 'patch' || value === 'restore';
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.trunc(value)
        : undefined;
}
