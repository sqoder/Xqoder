import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';

const workflowPath = path.resolve(import.meta.dir, '../.github/workflows/manual-e2e.yml');

describe('manual e2e workflow', () => {
    it('routes through the scripted runner with deploy disabled by default', () => {
        const workflow = fs.readFileSync(workflowPath, 'utf-8');

        expect(workflow).toContain("XQODER_REAL_DEPLOY_E2E: '0'");
        expect(workflow).toContain('name: Run manual E2E runner');
        expect(workflow).toContain('run: node scripts/run-manual-e2e.mjs');
    });
});
