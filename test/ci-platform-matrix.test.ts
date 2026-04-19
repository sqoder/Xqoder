import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';

const workflowPath = path.resolve(import.meta.dir, '../.github/workflows/platform-matrix.yml');

describe('platform matrix workflow', () => {
    it('keeps Windows quality gates aligned with build, lint, and test', () => {
        const workflow = fs.readFileSync(workflowPath, 'utf-8');
        const windowsSection = workflow.split('windows-preview:')[1] ?? '';

        expect(windowsSection).toContain('name: Build Windows CLI');
        expect(windowsSection).toContain('name: Lint');
        expect(windowsSection).toContain('run: bun run lint');
        expect(windowsSection).toContain('name: Test');
        expect(windowsSection).toContain('run: bun run test');
        expect(windowsSection).toContain('name: CLI smoke test');
        expect(windowsSection).toContain('run: bun run e2e:smoke');
    });
});
