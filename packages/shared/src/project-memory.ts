import * as fs from 'node:fs';
import * as path from 'node:path';

export const PROJECT_MEMORY_VERSION = 1;

export interface ProjectMemorySessionCommand {
    command: string;
    success: boolean;
}

export interface ProjectMemorySessionFileChange {
    path: string;
    changeType: 'write' | 'patch' | 'restore';
    success: boolean;
}

export interface ProjectMemorySessionTool {
    name: string;
    success: boolean;
}

export interface ProjectMemorySessionSummary {
    sessionId: string;
    updatedAt: string;
    compactSummary?: string;
    recentCommands: ProjectMemorySessionCommand[];
    recentFileChanges: ProjectMemorySessionFileChange[];
    recentTools: ProjectMemorySessionTool[];
}

export interface ProjectMemoryFailureBucket {
    bucket: string;
    count: number;
}

export interface ProjectMemoryFlowSummary {
    flow: 'build' | 'fix' | 'test' | 'deploy';
    count: number;
    successRate: number;
}

export interface ProjectMemoryPromotionCandidate {
    actionId: string;
    bucket: string;
    count: number;
    successRate: number;
}

export interface ProjectMemoryWorkflowSummary {
    updatedAt: string;
    totalRuns: number;
    successRate: number;
    failureBuckets: ProjectMemoryFailureBucket[];
    byFlow: ProjectMemoryFlowSummary[];
    automaticActionPromotionCandidates: ProjectMemoryPromotionCandidate[];
}

export interface ProjectMemorySnapshot {
    version: typeof PROJECT_MEMORY_VERSION;
    projectRoot: string;
    updatedAt: string;
    session?: ProjectMemorySessionSummary;
    workflow?: ProjectMemoryWorkflowSummary;
}

export function getProjectMemoryFilePath(projectRoot: string): string {
    return path.join(path.resolve(projectRoot), '.xqoder', 'project-memory.json');
}

export function readProjectMemoryFile(projectRoot: string): ProjectMemorySnapshot | null {
    const filePath = getProjectMemoryFilePath(projectRoot);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return normalizeProjectMemorySnapshot(JSON.parse(raw), projectRoot);
    } catch {
        return null;
    }
}

export function writeProjectMemoryFile(
    projectRoot: string,
    snapshot: ProjectMemorySnapshot,
): ProjectMemorySnapshot {
    const normalized = normalizeProjectMemorySnapshot(snapshot, projectRoot);
    const filePath = getProjectMemoryFilePath(projectRoot);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
}

export function normalizeProjectMemorySnapshot(
    value: unknown,
    projectRootOverride?: string,
): ProjectMemorySnapshot {
    const source = typeof value === 'object' && value !== null
        ? value as Partial<ProjectMemorySnapshot>
        : {};
    const projectRoot = path.resolve(readString(projectRootOverride) ?? readString(source.projectRoot) ?? process.cwd());

    return {
        version: PROJECT_MEMORY_VERSION,
        projectRoot,
        updatedAt: readString(source.updatedAt) ?? new Date().toISOString(),
        ...(source.session ? { session: normalizeProjectMemorySessionSummary(source.session) } : {}),
        ...(source.workflow ? { workflow: normalizeProjectMemoryWorkflowSummary(source.workflow) } : {}),
    };
}

function normalizeProjectMemorySessionSummary(value: unknown): ProjectMemorySessionSummary {
    const source = typeof value === 'object' && value !== null
        ? value as Partial<ProjectMemorySessionSummary>
        : {};

    return {
        sessionId: readString(source.sessionId) ?? 'unknown-session',
        updatedAt: readString(source.updatedAt) ?? new Date().toISOString(),
        ...(readString(source.compactSummary) ? { compactSummary: readString(source.compactSummary) } : {}),
        recentCommands: Array.isArray(source.recentCommands)
            ? source.recentCommands
                .map(normalizeProjectMemorySessionCommand)
                .filter((entry): entry is ProjectMemorySessionCommand => entry !== null)
            : [],
        recentFileChanges: Array.isArray(source.recentFileChanges)
            ? source.recentFileChanges
                .map(normalizeProjectMemorySessionFileChange)
                .filter((entry): entry is ProjectMemorySessionFileChange => entry !== null)
            : [],
        recentTools: Array.isArray(source.recentTools)
            ? source.recentTools
                .map(normalizeProjectMemorySessionTool)
                .filter((entry): entry is ProjectMemorySessionTool => entry !== null)
            : [],
    };
}

function normalizeProjectMemorySessionCommand(value: unknown): ProjectMemorySessionCommand | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const source = value as Partial<ProjectMemorySessionCommand>;
    const command = readString(source.command);
    if (!command) {
        return null;
    }

    return {
        command,
        success: Boolean(source.success),
    };
}

function normalizeProjectMemorySessionFileChange(value: unknown): ProjectMemorySessionFileChange | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const source = value as Partial<ProjectMemorySessionFileChange>;
    const filePath = readString(source.path);
    const changeType = source.changeType;
    if (!filePath || (changeType !== 'write' && changeType !== 'patch' && changeType !== 'restore')) {
        return null;
    }

    return {
        path: filePath,
        changeType,
        success: Boolean(source.success),
    };
}

function normalizeProjectMemorySessionTool(value: unknown): ProjectMemorySessionTool | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const source = value as Partial<ProjectMemorySessionTool>;
    const name = readString(source.name);
    if (!name) {
        return null;
    }

    return {
        name,
        success: Boolean(source.success),
    };
}

function normalizeProjectMemoryWorkflowSummary(value: unknown): ProjectMemoryWorkflowSummary {
    const source = typeof value === 'object' && value !== null
        ? value as Partial<ProjectMemoryWorkflowSummary>
        : {};

    return {
        updatedAt: readString(source.updatedAt) ?? new Date().toISOString(),
        totalRuns: readNumber(source.totalRuns) ?? 0,
        successRate: readNumber(source.successRate) ?? 0,
        failureBuckets: Array.isArray(source.failureBuckets)
            ? source.failureBuckets
                .map(normalizeProjectMemoryFailureBucket)
                .filter((entry): entry is ProjectMemoryFailureBucket => entry !== null)
            : [],
        byFlow: Array.isArray(source.byFlow)
            ? source.byFlow
                .map(normalizeProjectMemoryFlowSummary)
                .filter((entry): entry is ProjectMemoryFlowSummary => entry !== null)
            : [],
        automaticActionPromotionCandidates: Array.isArray(source.automaticActionPromotionCandidates)
            ? source.automaticActionPromotionCandidates
                .map(normalizeProjectMemoryPromotionCandidate)
                .filter((entry): entry is ProjectMemoryPromotionCandidate => entry !== null)
            : [],
    };
}

function normalizeProjectMemoryFailureBucket(value: unknown): ProjectMemoryFailureBucket | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const source = value as Partial<ProjectMemoryFailureBucket>;
    const bucket = readString(source.bucket);
    const count = readNumber(source.count);
    if (!bucket || count === undefined) {
        return null;
    }

    return { bucket, count };
}

function normalizeProjectMemoryFlowSummary(value: unknown): ProjectMemoryFlowSummary | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const source = value as Partial<ProjectMemoryFlowSummary>;
    const flow = source.flow;
    const count = readNumber(source.count);
    const successRate = readNumber(source.successRate);
    if ((flow !== 'build' && flow !== 'fix' && flow !== 'test' && flow !== 'deploy')
        || count === undefined
        || successRate === undefined) {
        return null;
    }

    return {
        flow,
        count,
        successRate,
    };
}

function normalizeProjectMemoryPromotionCandidate(value: unknown): ProjectMemoryPromotionCandidate | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const source = value as Partial<ProjectMemoryPromotionCandidate>;
    const actionId = readString(source.actionId);
    const bucket = readString(source.bucket);
    const count = readNumber(source.count);
    const successRate = readNumber(source.successRate);
    if (!actionId || !bucket || count === undefined || successRate === undefined) {
        return null;
    }

    return {
        actionId,
        bucket,
        count,
        successRate,
    };
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
