import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { PackageManagerDetector } from '../../../features/runtime/package-manager-detector.js';
import { buildShellCommandInvocation, type ShellCommandConfig } from '../../../features/runtime/shell-command.js';
import type { MvpBaselineComparisonResult, MvpTestBaseline } from './types.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const SCRIPT_CANDIDATES = ['test', 'test:unit'] as const;

export async function detectMvpTestCommand(projectRoot: string): Promise<string | null> {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        return null;
    }

    try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
            scripts?: Record<string, string>;
        };
        const scripts = packageJson.scripts ?? {};
        const detector = new PackageManagerDetector();
        const packageManager = detector.detect(projectRoot);

        for (const scriptName of SCRIPT_CANDIDATES) {
            if (typeof scripts[scriptName] === 'string' && scripts[scriptName].trim().length > 0) {
                return detector.buildScriptCommand(scriptName, packageManager);
            }
        }
    } catch {
        return null;
    }

    return null;
}

export async function captureMvpTestBaseline(input: {
    projectRoot: string;
    command?: string | null;
    shell?: ShellCommandConfig;
    timeoutMs?: number;
}): Promise<MvpTestBaseline | null> {
    const command = input.command ?? await detectMvpTestCommand(input.projectRoot);
    if (!command) {
        return null;
    }

    const startedAt = Date.now();
    const execution = await executeShellCommand({
        command,
        cwd: input.projectRoot,
        shell: input.shell,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const combinedOutput = `${execution.stdout}\n${execution.stderr}`.trim();
    const parsed = parseTestStatuses(combinedOutput, execution.exitCode, execution.timedOut);

    return {
        timestamp: startedAt,
        command,
        cwd: input.projectRoot,
        passed: parsed.passed,
        failed: parsed.failed,
        tests: parsed.tests,
    };
}

export function compareMvpTestBaselines(
    baseline: MvpTestBaseline,
    current: MvpTestBaseline,
): MvpBaselineComparisonResult {
    const regressions: string[] = [];
    const newPasses: string[] = [];

    for (const [name, previousStatus] of Object.entries(baseline.tests)) {
        const nextStatus = current.tests[name];
        if (previousStatus === 'pass' && nextStatus === 'fail') {
            regressions.push(name);
        }
        if (previousStatus === 'fail' && nextStatus === 'pass') {
            newPasses.push(name);
        }
    }

    if (regressions.length === 0 && current.failed > baseline.failed) {
        regressions.push(`failure-count:+${current.failed - baseline.failed}`);
    }

    return {
        hasRegression: regressions.length > 0,
        regressions,
        newPasses,
        baseline,
        current,
    };
}

export function formatMvpBaselineSignal(
    comparison: MvpBaselineComparisonResult | null,
    command?: string,
): { status: 'passed' | 'failed' | 'skipped'; line: string } {
    if (!comparison) {
        return {
            status: 'skipped',
            line: 'Baseline check: skipped (no test command detected)',
        };
    }

    if (comparison.hasRegression) {
        const details = comparison.regressions.join(', ');
        return {
            status: 'failed',
            line: `Baseline check: failed (rolled back regression${details ? `: ${details}` : ''})`,
        };
    }

    return {
        status: 'passed',
        line: `Baseline check: passed (${comparison.current.passed} passed, ${comparison.current.failed} failed${command ? `; ${command}` : ''})`,
    };
}

interface ShellExecutionResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}

async function executeShellCommand(input: {
    command: string;
    cwd: string;
    shell?: ShellCommandConfig;
    timeoutMs: number;
}): Promise<ShellExecutionResult> {
    const invocation = buildShellCommandInvocation(input.command, input.shell);

    return new Promise<ShellExecutionResult>((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const child = spawn(invocation.executable, invocation.args, {
            cwd: input.cwd,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
        }, input.timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({
                exitCode: timedOut ? 1 : code ?? 1,
                stdout: stripAnsi(stdout).trim(),
                stderr: stripAnsi(stderr).trim(),
                timedOut,
            });
        });

        child.on('error', (error) => {
            clearTimeout(timer);
            resolve({
                exitCode: 1,
                stdout: '',
                stderr: `Failed to start baseline command: ${error.message}`,
                timedOut: false,
            });
        });
    });
}

function parseTestStatuses(
    output: string,
    exitCode: number,
    timedOut: boolean,
): {
    tests: Record<string, 'pass' | 'fail' | 'skip'>;
    passed: number;
    failed: number;
} {
    const tests: Record<string, 'pass' | 'fail' | 'skip'> = {};
    const lines = output.split('\n');
    const patterns: Array<{ status: 'pass' | 'fail'; regex: RegExp }> = [
        { status: 'pass', regex: /^\s*[✓✔√]\s+(.+?)(?:\s+\[[^\]]+\])?\s*$/ },
        { status: 'fail', regex: /^\s*[✗×]\s+(.+?)(?:\s+\[[^\]]+\])?\s*$/ },
        { status: 'pass', regex: /^\s*\(pass\)\s+(.+?)(?:\s+\[[^\]]+\])?\s*$/i },
        { status: 'fail', regex: /^\s*\(fail\)\s+(.+?)(?:\s+\[[^\]]+\])?\s*$/i },
        { status: 'pass', regex: /^\s*ok\s+\d+\s+-\s+(.+?)\s*$/i },
        { status: 'fail', regex: /^\s*not ok\s+\d+\s+-\s+(.+?)\s*$/i },
        { status: 'fail', regex: /^\s*FAIL\s+(.+?)\s*$/ },
        { status: 'pass', regex: /^\s*PASS\s+(.+?)\s*$/ },
    ];

    for (const line of lines) {
        for (const pattern of patterns) {
            const match = line.match(pattern.regex);
            if (!match?.[1]) {
                continue;
            }
            const testName = normalizeTestName(match[1]);
            if (!testName) {
                continue;
            }
            tests[testName] = pattern.status;
            break;
        }
    }

    let passed = countByStatus(tests, 'pass');
    let failed = countByStatus(tests, 'fail');

    if (passed === 0) {
        passed = readSummaryCount(output, [
            /\b(\d+)\s+(?:pass|passed)\b/i,
            /\bpass:\s*(\d+)\b/i,
        ]);
    }
    if (failed === 0) {
        failed = readSummaryCount(output, [
            /\b(\d+)\s+(?:fail|failed)\b/i,
            /\bfail:\s*(\d+)\b/i,
        ]);
    }

    if (Object.keys(tests).length === 0 && (failed > 0 || exitCode !== 0 || timedOut)) {
        tests['__suite__'] = 'fail';
        failed = Math.max(failed, 1);
    }

    return { tests, passed, failed };
}

function countByStatus(
    tests: Record<string, 'pass' | 'fail' | 'skip'>,
    status: 'pass' | 'fail',
): number {
    return Object.values(tests).filter((value) => value === status).length;
}

function readSummaryCount(output: string, patterns: RegExp[]): number {
    for (const pattern of patterns) {
        const match = output.match(pattern);
        if (!match?.[1]) {
            continue;
        }
        const parsed = Number.parseInt(match[1], 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return 0;
}

function normalizeTestName(value: string): string {
    return value
        .replace(/\s+\[[^\]]+\]\s*$/, '')
        .replace(/\s+\(\d+\s*ms\)\s*$/i, '')
        .trim();
}

function stripAnsi(value: string): string {
    return value.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}
