import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { RunShellTool, resetPersistentShellsForTests, resolveInstallPackageExecution } from '../src/core/agent/tools/command-tool.js';

afterEach(() => {
    resetPersistentShellsForTests();
});

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

    it('rejects run_shell redirection outside the sandbox before execution', async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-shell-sandbox-'));
        const outsideName = `${path.basename(cwd)}-outside.txt`;
        const outsidePath = path.join(path.dirname(cwd), outsideName);
        try {
            fs.rmSync(outsidePath, { force: true });
            const tool = new RunShellTool();
            const result = await tool.execute({
                command: `echo pwned > ../${outsideName}`,
                toolCallId: 'shell-redirection-1',
            }, {
                cwd,
                projectRoot: cwd,
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('Command rejected by sandbox');
            expect(result.error).toContain('redirection outside the allowed workspace');
            expect(fs.existsSync(outsidePath)).toBe(false);
        } finally {
            fs.rmSync(outsidePath, { force: true });
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('rejects obvious sensitive environment reads and still allows ordinary commands', async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-shell-sandbox-'));
        try {
            const tool = new RunShellTool();
            const rejected = await tool.execute({
                command: 'echo $OPENAI_API_KEY',
                toolCallId: 'shell-env-1',
            }, {
                cwd,
                projectRoot: cwd,
                env: {
                    OPENAI_API_KEY: 'secret',
                },
            });

            expect(rejected.success).toBe(false);
            expect(rejected.error).toContain('sensitive environment variable');

            const allowed = await tool.execute({
                command: 'pwd',
                toolCallId: 'shell-pwd-1',
            }, {
                cwd,
                projectRoot: cwd,
            });

            expect(allowed.success).toBe(true);
            expect(allowed.output).toContain(cwd);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('does not reuse a persistent session shell across different requested working directories', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-shell-cwd-'));
        const firstCwd = path.join(root, 'first');
        const secondCwd = path.join(root, 'second');
        fs.mkdirSync(firstCwd, { recursive: true });
        fs.mkdirSync(secondCwd, { recursive: true });

        try {
            const tool = new RunShellTool();
            const baseContext = {
                cwd: root,
                projectRoot: root,
                sessionId: 'shared-session',
            };

            const first = await tool.execute({
                command: 'pwd',
                cwd: firstCwd,
                toolCallId: 'shell-cwd-1',
            }, baseContext);
            const second = await tool.execute({
                command: 'pwd',
                cwd: secondCwd,
                toolCallId: 'shell-cwd-2',
            }, baseContext);

            expect(first.success).toBe(true);
            expect(fs.realpathSync.native(first.output.trim())).toBe(fs.realpathSync.native(firstCwd));
            expect(second.success).toBe(true);
            expect(fs.realpathSync.native(second.output.trim())).toBe(fs.realpathSync.native(secondCwd));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
