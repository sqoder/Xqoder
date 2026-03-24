import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TestStatus } from '@xqoder/shared';
import { ProjectTestRunner } from './test-runner.js';

const tempDirs: string[] = [];

function createTempProject(options: {
    packageJson?: Record<string, unknown>;
    files: Record<string, string>;
    lockfile?: 'pnpm' | 'yarn';
}): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-test-runner-'));
    tempDirs.push(dir);
    if (options.packageJson) {
        fs.writeFileSync(
            path.join(dir, 'package.json'),
            JSON.stringify(options.packageJson, null, 2),
            'utf-8',
        );
    }

    for (const [filePath, content] of Object.entries(options.files)) {
        const fullPath = path.join(dir, filePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf-8');
    }

    if (options.lockfile === 'pnpm') {
        fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    }

    if (options.lockfile === 'yarn') {
        fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
    }

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

describe('ProjectTestRunner', () => {
    it('returns skipped when no test script is configured', async () => {
        const projectDir = createTempProject({
            packageJson: {
                name: 'no-tests',
                private: true,
            },
            files: {},
        });

        const runner = new ProjectTestRunner();
        const report = await runner.run(projectDir);

        expect(report.status).toBe(TestStatus.Skipped);
        expect(report.skipped).toBe(1);
    });

    it('runs the package manager test script and returns a passing report', async () => {
        const projectDir = createTempProject({
            packageJson: {
                name: 'passing-tests',
                private: true,
                scripts: {
                    test: 'node pass.js',
                },
            },
            files: {
                'pass.js': "console.log('tests ok');\n",
            },
            lockfile: 'pnpm',
        });

        const runner = new ProjectTestRunner();
        const report = await runner.run(projectDir);

        expect(report.status).toBe(TestStatus.Passed);
        expect(report.packageManager).toBe('pnpm');
        expect(report.command).toBe('pnpm run test');
        expect(report.passed).toBeGreaterThan(0);
    });

    it('returns structured failure output when the test command exits non-zero', async () => {
        const projectDir = createTempProject({
            packageJson: {
                name: 'failing-tests',
                private: true,
                scripts: {
                    test: 'node fail.js',
                },
            },
            files: {
                'fail.js': "console.error('FAIL unit should work');\nprocess.exit(1);\n",
            },
        });

        const runner = new ProjectTestRunner();
        const report = await runner.run(projectDir);

        expect(report.status).toBe(TestStatus.Failed);
        expect(report.failed).toBeGreaterThan(0);
        expect(report.failures[0]?.message).toContain('FAIL unit should work');
    });

    it('runs an explicit test command even when package.json is missing', async () => {
        const projectDir = createTempProject({
            files: {
                'pass.js': "console.log('external tests ok');\n",
            },
        });

        const runner = new ProjectTestRunner();
        const report = await runner.run(projectDir, {
            command: 'node pass.js',
        });

        expect(report.status).toBe(TestStatus.Passed);
        expect(report.command).toBe('node pass.js');
        expect(report.packageManager).toBeUndefined();
    });

    it('returns failed when package.json is missing and no command is provided', async () => {
        const projectDir = createTempProject({
            files: {},
        });

        const runner = new ProjectTestRunner();
        const report = await runner.run(projectDir);

        expect(report.status).toBe(TestStatus.Failed);
        expect(report.failures[0]?.message).toContain('未找到 package.json');
    });
});
