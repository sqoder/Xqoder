import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { resolveInstallPackageExecution } from '../src/core/agent/tools/command-tool.js';

describe('command tool helpers', () => {
    it('builds argv for supported package managers without shell interpolation', () => {
        const cases = [
            {
                files: ['package.json', 'bun.lockb'],
                input: { packages: 'left-pad @scope/pkg@1.2.3', dev: true },
                expected: {
                    packageManager: 'bun',
                    executable: 'bun',
                    args: ['add', '-d', 'left-pad', '@scope/pkg@1.2.3'],
                    commandForDisplay: 'bun add -d left-pad @scope/pkg@1.2.3',
                },
            },
            {
                files: ['package.json', 'pnpm-lock.yaml'],
                input: { packages: 'left-pad', dev: true },
                expected: {
                    packageManager: 'pnpm',
                    executable: 'pnpm',
                    args: ['add', '-D', 'left-pad'],
                    commandForDisplay: 'pnpm add -D left-pad',
                },
            },
            {
                files: ['package.json', 'yarn.lock'],
                input: { packages: 'left-pad', dev: true },
                expected: {
                    packageManager: 'yarn',
                    executable: 'yarn',
                    args: ['add', '--dev', 'left-pad'],
                    commandForDisplay: 'yarn add --dev left-pad',
                },
            },
            {
                files: ['package.json'],
                input: { packages: 'left-pad' },
                expected: {
                    packageManager: 'npm',
                    executable: 'npm',
                    args: ['install', 'left-pad'],
                    commandForDisplay: 'npm install left-pad',
                },
            },
            {
                files: ['requirements.txt'],
                input: { packages: 'requests rich' },
                expected: {
                    packageManager: 'pip',
                    executable: 'pip',
                    args: ['install', 'requests', 'rich'],
                    commandForDisplay: 'pip install requests rich',
                },
            },
        ] as const;

        for (const testCase of cases) {
            const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-install-package-'));
            try {
                for (const relativePath of testCase.files) {
                    fs.writeFileSync(path.join(cwd, relativePath), '{}', 'utf-8');
                }

                expect(resolveInstallPackageExecution({
                    cwd,
                    packages: testCase.input.packages,
                    dev: testCase.input.dev,
                })).toMatchObject(testCase.expected);
            } finally {
                fs.rmSync(cwd, { recursive: true, force: true });
            }
        }
    });

    it('rejects shell syntax and control characters in package lists', () => {
        expect(() => resolveInstallPackageExecution({
            cwd: '/tmp',
            packages: 'left-pad; touch /tmp/pwn',
        })).toThrow(/unsupported shell syntax/i);

        expect(() => resolveInstallPackageExecution({
            cwd: '/tmp',
            packages: 'left-pad\nnext-package',
        })).toThrow(/control characters/i);
    });
});
