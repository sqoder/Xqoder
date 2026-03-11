import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplyPatchTool, RestoreRollbackPointTool } from './patch-tool.js';
import { FileRollbackStore } from './rollback-store.js';

const tempDirs: string[] = [];

function createToolContext(): {
    projectRoot: string;
    cwd: string;
    sessionId: string;
    rollbackStore: FileRollbackStore;
} {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-patch-tool-'));
    const rollbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-rollbacks-'));
    tempDirs.push(projectRoot, rollbackDir);

    return {
        projectRoot,
        cwd: projectRoot,
        sessionId: 'session_demo',
        rollbackStore: new FileRollbackStore(rollbackDir),
    };
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('patch tool', () => {
    it('applies a patch and can restore via rollback point', async () => {
        const context = createToolContext();
        const filePath = path.join(context.projectRoot, 'src', 'index.ts');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, "console.log('old');\n", 'utf-8');
        const patch = [
            'diff --git a/src/index.ts b/src/index.ts',
            '--- a/src/index.ts',
            '+++ b/src/index.ts',
            '@@ -1 +1 @@',
            "-console.log('old');",
            "+console.log('new');",
            '',
        ].join('\n');

        const approval = new ApplyPatchTool().buildApprovalRequest({
            patch,
        }, context);
        const applyResult = await new ApplyPatchTool().execute({
            patch,
            toolCallId: '1',
        }, context);
        const rollbackPointId = applyResult.metadata?.['rollbackPointId'];

        expect(approval.preview).toContain("+console.log('new');");
        expect(applyResult.success).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toContain("console.log('new');");
        expect(typeof rollbackPointId).toBe('string');

        const restoreResult = await new RestoreRollbackPointTool().execute({
            rollbackPointId,
            toolCallId: '2',
        }, context);

        expect(restoreResult.success).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toContain("console.log('old');");
    });
});
