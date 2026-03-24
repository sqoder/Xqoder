import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    appendProjectPermissionAuditLog,
    getProjectPermissionAuditLogPath,
    getProjectPermissionsFilePath,
    isAutomaticActionPromoted,
    readProjectPermissionFile,
    syncProjectAutomaticActionPromotions,
} from './project-permissions.js';

const tempDirs: string[] = [];

function createTempProjectDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-project-permissions-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('project permissions', () => {
    it('persists automatic action promotions into .xqoder/permissions.json', () => {
        const projectRoot = createTempProjectDir();

        const snapshot = syncProjectAutomaticActionPromotions(projectRoot, [{
            actionId: 'auto-install-dependency-v1',
            bucket: 'runtime_dependency_missing',
            count: 4,
            successfulRuns: 4,
            failedRuns: 0,
            successRate: 1,
        }], new Date('2026-03-23T00:00:00.000Z'));

        expect(fs.existsSync(getProjectPermissionsFilePath(projectRoot))).toBe(true);
        expect(snapshot.automaticActionPromotions).toEqual([
            expect.objectContaining({
                actionId: 'auto-install-dependency-v1',
                bucket: 'runtime_dependency_missing',
                count: 4,
                successRate: 1,
            }),
        ]);
        expect(isAutomaticActionPromoted(snapshot, 'auto-install-dependency-v1', 'runtime_dependency_missing')).toBe(true);
        expect(readProjectPermissionFile(projectRoot)).toEqual(snapshot);
    });

    it('appends structured audit entries into .xqoder/audit.log', () => {
        const projectRoot = createTempProjectDir();

        appendProjectPermissionAuditLog(projectRoot, {
            timestamp: '2026-03-23T00:10:00.000Z',
            source: 'automatic-action',
            kind: 'automatic-action.execution',
            decision: 'allow',
            actionId: 'auto-install-dependency-v1',
            bucket: 'runtime_dependency_missing',
            cwd: projectRoot,
            reason: 'persisted promotion matched',
        });

        const auditPath = getProjectPermissionAuditLogPath(projectRoot);
        expect(fs.existsSync(auditPath)).toBe(true);
        const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n');
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
            source: 'automatic-action',
            kind: 'automatic-action.execution',
            decision: 'allow',
            actionId: 'auto-install-dependency-v1',
            bucket: 'runtime_dependency_missing',
        });
    });
});
