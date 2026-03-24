import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentPermissionMode } from './config-types.js';

export const PROJECT_PERMISSION_VERSION = 1;

export interface ProjectAutomaticActionPromotion {
    actionId: string;
    bucket: string;
    count: number;
    successfulRuns: number;
    failedRuns: number;
    successRate: number;
    updatedAt: string;
}

export interface ProjectPermissionSnapshot {
    version: typeof PROJECT_PERMISSION_VERSION;
    projectRoot: string;
    updatedAt: string;
    toolRules: Record<string, AgentPermissionMode>;
    automaticActionPromotions: ProjectAutomaticActionPromotion[];
}

export interface ProjectPermissionAuditEntry {
    timestamp: string;
    source: 'workflow-history' | 'automatic-action' | 'config' | 'runtime' | 'plan-mode';
    kind: 'automatic-action.promotion' | 'automatic-action.execution' | 'tool.use';
    decision: 'allow' | 'ask' | 'deny';
    actionId?: string;
    bucket?: string;
    toolName?: string;
    permissionKey?: string;
    cwd?: string;
    sessionId?: string;
    reason?: string;
}

export interface AutomaticActionPromotionCandidateInput {
    actionId: string;
    bucket: string;
    count: number;
    successfulRuns: number;
    failedRuns: number;
    successRate: number;
}

export function getProjectPermissionsFilePath(projectRoot: string): string {
    return path.join(path.resolve(projectRoot), '.xqoder', 'permissions.json');
}

export function getProjectPermissionAuditLogPath(projectRoot: string): string {
    return path.join(path.resolve(projectRoot), '.xqoder', 'audit.log');
}

export function readProjectPermissionFile(projectRoot: string): ProjectPermissionSnapshot | null {
    const filePath = getProjectPermissionsFilePath(projectRoot);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return normalizeProjectPermissionSnapshot(JSON.parse(raw), projectRoot);
    } catch {
        return null;
    }
}

export function writeProjectPermissionFile(
    projectRoot: string,
    snapshot: ProjectPermissionSnapshot,
): ProjectPermissionSnapshot {
    const normalized = normalizeProjectPermissionSnapshot(snapshot, projectRoot);
    const filePath = getProjectPermissionsFilePath(projectRoot);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
}

export function syncProjectAutomaticActionPromotions(
    projectRoot: string,
    candidates: AutomaticActionPromotionCandidateInput[],
    updatedAt: Date = new Date(),
): ProjectPermissionSnapshot {
    const current = readProjectPermissionFile(projectRoot);
    return writeProjectPermissionFile(projectRoot, {
        version: PROJECT_PERMISSION_VERSION,
        projectRoot: path.resolve(projectRoot),
        updatedAt: updatedAt.toISOString(),
        toolRules: current?.toolRules ?? {},
        automaticActionPromotions: normalizeAutomaticActionPromotions(candidates, updatedAt),
    });
}

export function isAutomaticActionPromoted(
    snapshot: ProjectPermissionSnapshot | null | undefined,
    actionId: string,
    bucket: string,
): boolean {
    return Boolean(snapshot?.automaticActionPromotions.some((entry) => entry.actionId === actionId && entry.bucket === bucket));
}

export function appendProjectPermissionAuditLog(
    projectRoot: string,
    entry: ProjectPermissionAuditEntry,
): void {
    const normalizedRoot = path.resolve(projectRoot);
    if (!fs.existsSync(normalizedRoot)) {
        return;
    }

    const filePath = getProjectPermissionAuditLogPath(normalizedRoot);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(normalizeProjectPermissionAuditEntry(entry))}\n`, 'utf8');
}

export function normalizeProjectPermissionSnapshot(
    value: unknown,
    projectRootOverride?: string,
): ProjectPermissionSnapshot {
    const source = typeof value === 'object' && value !== null
        ? value as Partial<ProjectPermissionSnapshot>
        : {};
    const projectRoot = path.resolve(readString(projectRootOverride) ?? readString(source.projectRoot) ?? process.cwd());

    return {
        version: PROJECT_PERMISSION_VERSION,
        projectRoot,
        updatedAt: readString(source.updatedAt) ?? new Date().toISOString(),
        toolRules: normalizeToolRules(source.toolRules),
        automaticActionPromotions: normalizeAutomaticActionPromotions(source.automaticActionPromotions ?? [], new Date()),
    };
}

function normalizeAutomaticActionPromotions(
    value: unknown,
    fallbackUpdatedAt: Date,
): ProjectAutomaticActionPromotion[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const promotions = value
        .map((entry) => normalizeAutomaticActionPromotion(entry, fallbackUpdatedAt))
        .filter((entry): entry is ProjectAutomaticActionPromotion => entry !== null)
        .sort((left, right) => {
            const actionDiff = left.actionId.localeCompare(right.actionId);
            if (actionDiff !== 0) {
                return actionDiff;
            }
            return left.bucket.localeCompare(right.bucket);
        });

    const deduped = new Map<string, ProjectAutomaticActionPromotion>();
    for (const entry of promotions) {
        deduped.set(`${entry.actionId}::${entry.bucket}`, entry);
    }

    return [...deduped.values()];
}

function normalizeAutomaticActionPromotion(
    value: unknown,
    fallbackUpdatedAt: Date,
): ProjectAutomaticActionPromotion | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const source = value as Partial<ProjectAutomaticActionPromotion>;
    const actionId = readString(source.actionId);
    const bucket = readString(source.bucket);
    const count = readNumber(source.count);
    const successfulRuns = readNumber(source.successfulRuns);
    const failedRuns = readNumber(source.failedRuns);
    const successRate = readNumber(source.successRate);

    if (!actionId || !bucket || count === undefined || successfulRuns === undefined || failedRuns === undefined || successRate === undefined) {
        return null;
    }

    return {
        actionId,
        bucket,
        count,
        successfulRuns,
        failedRuns,
        successRate,
        updatedAt: readString(source.updatedAt) ?? fallbackUpdatedAt.toISOString(),
    };
}

function normalizeToolRules(value: unknown): Record<string, AgentPermissionMode> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .map(([toolName, mode]) => [toolName.trim(), mode])
            .filter((entry): entry is [string, AgentPermissionMode] => (
                entry[0].length > 0
                && (entry[1] === 'allow' || entry[1] === 'ask' || entry[1] === 'deny')
            )),
    );
}

function normalizeProjectPermissionAuditEntry(entry: ProjectPermissionAuditEntry): ProjectPermissionAuditEntry {
    return {
        timestamp: readString(entry.timestamp) ?? new Date().toISOString(),
        source: entry.source,
        kind: entry.kind,
        decision: entry.decision,
        ...(readString(entry.actionId) ? { actionId: readString(entry.actionId) } : {}),
        ...(readString(entry.bucket) ? { bucket: readString(entry.bucket) } : {}),
        ...(readString(entry.toolName) ? { toolName: readString(entry.toolName) } : {}),
        ...(readString(entry.permissionKey) ? { permissionKey: readString(entry.permissionKey) } : {}),
        ...(readString(entry.cwd) ? { cwd: readString(entry.cwd) } : {}),
        ...(readString(entry.sessionId) ? { sessionId: readString(entry.sessionId) } : {}),
        ...(readString(entry.reason) ? { reason: readString(entry.reason) } : {}),
    };
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
}
