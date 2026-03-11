import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    TestStatus,
    type TestFailure,
    type TestReport,
} from '@xqoder/shared';
import { PackageManagerDetector } from './package-manager-detector.js';

export interface ProjectTestRunnerOptions {
    command?: string;
    timeout?: number;
}

export class ProjectTestRunner {
    private readonly packageManagerDetector: PackageManagerDetector;

    constructor(
        packageManagerDetector: PackageManagerDetector = new PackageManagerDetector(),
    ) {
        this.packageManagerDetector = packageManagerDetector;
    }

    async run(
        projectDir: string,
        options: ProjectTestRunnerOptions = {},
    ): Promise<TestReport> {
        const startedAt = new Date();
        const packageJsonPath = path.join(projectDir, 'package.json');

        if (!fs.existsSync(packageJsonPath)) {
            return {
                status: TestStatus.Failed,
                projectDir,
                output: '未找到 package.json，无法运行测试。',
                passed: 0,
                failed: 1,
                skipped: 0,
                failures: [{ message: '未找到 package.json，无法运行测试。' }],
                startedAt,
                completedAt: new Date(),
            };
        }

        const packageManager = this.packageManagerDetector.detect(projectDir);
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
            scripts?: Record<string, string>;
        };

        const command = options.command
            ?? (packageJson.scripts?.['test']
                ? this.packageManagerDetector.buildScriptCommand('test', packageManager)
                : undefined);

        if (!command) {
            return {
                status: TestStatus.Skipped,
                projectDir,
                packageManager,
                output: '未配置 test script，跳过测试验证。',
                passed: 0,
                failed: 0,
                skipped: 1,
                failures: [],
                startedAt,
                completedAt: new Date(),
            };
        }

        return new Promise<TestReport>((resolve) => {
            let output = '';
            let timedOut = false;
            const timeout = options.timeout ?? 120000;
            const child = spawn('sh', ['-c', command], {
                cwd: projectDir,
                env: process.env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            const timer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGTERM');
            }, timeout);

            child.stdout?.on('data', (chunk: Buffer) => {
                output += chunk.toString();
            });

            child.stderr?.on('data', (chunk: Buffer) => {
                output += chunk.toString();
            });

            child.on('close', (code) => {
                clearTimeout(timer);

                const cleanedOutput = stripAnsi(output);
                const counts = parseTestCounts(cleanedOutput);
                const failures = extractFailures(cleanedOutput);
                const status = timedOut
                    ? TestStatus.Failed
                    : code === 0
                        ? TestStatus.Passed
                        : TestStatus.Failed;

                resolve({
                    status,
                    projectDir,
                    packageManager,
                    command,
                    output: cleanedOutput.trim(),
                    passed: counts.passed > 0 ? counts.passed : status === TestStatus.Passed ? 1 : 0,
                    failed: counts.failed > 0 ? counts.failed : status === TestStatus.Failed ? 1 : 0,
                    skipped: counts.skipped,
                    failures: timedOut
                        ? [{ message: `测试超时 (${timeout}ms)` }]
                        : failures.length > 0
                            ? failures
                            : status === TestStatus.Failed
                                ? [{ message: summarizeFailure(cleanedOutput) }]
                                : [],
                    startedAt,
                    completedAt: new Date(),
                });
            });

            child.on('error', (error) => {
                clearTimeout(timer);
                resolve({
                    status: TestStatus.Failed,
                    projectDir,
                    packageManager,
                    command,
                    output: '',
                    passed: 0,
                    failed: 1,
                    skipped: 0,
                    failures: [{ message: `测试命令启动失败: ${error.message}` }],
                    startedAt,
                    completedAt: new Date(),
                });
            });
        });
    }
}

function parseTestCounts(output: string): {
    passed: number;
    failed: number;
    skipped: number;
} {
    return {
        passed: extractCount(output, /(\d+)\s+passed\b/gi),
        failed: extractCount(output, /(\d+)\s+failed\b/gi),
        skipped: extractCount(output, /(\d+)\s+skipped\b/gi),
    };
}

function extractCount(output: string, pattern: RegExp): number {
    let count = 0;
    for (const match of output.matchAll(pattern)) {
        count += Number.parseInt(match[1] ?? '0', 10);
    }
    return count;
}

function extractFailures(output: string): TestFailure[] {
    const lines = output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    return lines
        .filter((line) => /^(FAIL|×|✕)\b/.test(line))
        .slice(0, 10)
        .map((line) => ({ message: line }));
}

function summarizeFailure(output: string): string {
    const lastMeaningfulLine = output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);

    return lastMeaningfulLine ?? '测试失败';
}

function stripAnsi(value: string): string {
    return value.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}
