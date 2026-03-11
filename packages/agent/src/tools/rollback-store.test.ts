import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileRollbackStore } from './rollback-store.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

describe('FileRollbackStore', () => {
    it('lists rollback points for a project and loads point details', async () => {
        const rollbackDir = createTempDir('xqoder-rollback-store-');
        const projectA = createTempDir('xqoder-project-a-');
        const projectB = createTempDir('xqoder-project-b-');
        const store = new FileRollbackStore(rollbackDir);
        const readmePath = path.join(projectA, 'README.md');
        const configPath = path.join(projectB, 'config.json');
        const newFilePath = path.join(projectA, 'src', 'new.ts');

        fs.writeFileSync(readmePath, '# Demo\n', 'utf-8');
        fs.writeFileSync(configPath, '{"ok":true}\n', 'utf-8');

        const firstPoint = store.createPoint({
            sessionId: 'session_a',
            projectRoot: projectA,
            toolName: 'write_file',
            filePaths: [readmePath],
        });

        await new Promise((resolve) => setTimeout(resolve, 5));

        const secondPoint = store.createPoint({
            sessionId: 'session_a',
            projectRoot: projectA,
            toolName: 'apply_patch',
            filePaths: [newFilePath],
        });

        store.createPoint({
            sessionId: 'session_b',
            projectRoot: projectB,
            toolName: 'write_file',
            filePaths: [configPath],
        });

        const projectRollbacks = store.listPoints(projectA, 10);
        const details = store.getPointDetails(firstPoint.id);
        const latestOnly = store.listPoints(projectA, 1);

        expect(projectRollbacks.map((point) => point.id)).toEqual([secondPoint.id, firstPoint.id]);
        expect(details).toMatchObject({
            id: firstPoint.id,
            sessionId: 'session_a',
            projectRoot: projectA,
            toolName: 'write_file',
            filePaths: [readmePath],
            files: [
                {
                    path: readmePath,
                    existedBefore: true,
                    content: '# Demo\n',
                },
            ],
        });
        expect(store.getPointDetails(secondPoint.id)?.files).toEqual([
            {
                path: newFilePath,
                existedBefore: false,
            },
        ]);
        expect(latestOnly).toHaveLength(1);
        expect(latestOnly[0]?.id).toBe(secondPoint.id);
    });
});
