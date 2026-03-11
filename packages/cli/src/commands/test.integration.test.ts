import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TestStatus } from '@xqoder/shared';
import { createTestCommand, runTestCommand } from './test.js';

const tempDirs: string[] = [];

function createTempProject(options: {
    packageJson: Record<string, unknown>;
    files: Record<string, string>;
}): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-cli-test-'));
    tempDirs.push(dir);
    fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify(options.packageJson, null, 2),
        'utf-8',
    );

    for (const [filePath, content] of Object.entries(options.files)) {
        const fullPath = path.join(dir, filePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf-8');
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

describe('xqoder test integration', () => {
    it('runs a passing test script through the CLI command', async () => {
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
        });

        const command = createTestCommand();
        await command.parseAsync([
            '--dir',
            projectDir,
        ], { from: 'user' });

        const report = await runTestCommand({ dir: projectDir });
        expect(report.status).toBe(TestStatus.Passed);
    });

    it('returns a failing structured report for a broken test script', async () => {
        const projectDir = createTempProject({
            packageJson: {
                name: 'failing-tests',
                private: true,
                scripts: {
                    test: 'node fail.js',
                },
            },
            files: {
                'fail.js': "console.error('FAIL should fail');\nprocess.exit(1);\n",
            },
        });

        await expect(runTestCommand({ dir: projectDir })).rejects.toThrow('FAIL should fail');
    });
});
