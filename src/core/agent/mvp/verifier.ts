import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { PackageManagerDetector } from '../../../features/runtime/package-manager-detector.js';
import { buildShellCommandInvocation, type ShellCommandConfig } from '../../../features/runtime/shell-command.js';
import { distillMvpVerifierOutput } from './distiller.js';
import type {
    MvpDistilledResult,
    MvpVerificationCheckResult,
    MvpVerificationResult,
    MvpVerifierRawOutput,
} from './types.js';
import { createMvpOutputCheck } from './stop-condition.js';

interface PackageJsonWithScripts {
    scripts?: Record<string, string>;
}

interface ShellExecutionResult {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
}

export async function runMvpVerification(input: {
    projectRoot: string;
    shell?: ShellCommandConfig;
    timeoutMs?: number;
    distill?: boolean;
}): Promise<MvpVerificationResult> {
    const checks: MvpVerificationCheckResult[] = [];
    const packageJsonPath = path.join(input.projectRoot, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
        checks.push({
            name: 'test',
            status: 'skipped',
            summary: 'No package.json found; skipped test verification.',
        });
        checks.push({
            name: 'lint',
            status: 'skipped',
            summary: 'No package.json found; skipped lint verification.',
        });
        checks.push({
            name: 'build',
            status: 'skipped',
            summary: 'No package.json found; skipped build verification.',
        });
        checks.push(createMvpOutputCheck(checks));
        return finalizeVerification(checks);
    }

    const packageManagerDetector = new PackageManagerDetector();
    const packageManager = packageManagerDetector.detect(input.projectRoot);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageJsonWithScripts;
    const scriptNames: Array<'test' | 'lint' | 'build'> = ['test', 'lint', 'build'];

    for (const scriptName of scriptNames) {
        const script = packageJson.scripts?.[scriptName];
        if (!script) {
            checks.push({
                name: scriptName,
                status: 'skipped',
                summary: `No ${scriptName} script configured.`,
            });
            continue;
        }

        const command = packageManagerDetector.buildScriptCommand(scriptName, packageManager);
        const result = await executeShellCommand({
            command,
            cwd: input.projectRoot,
            shell: input.shell,
            timeoutMs: input.timeoutMs ?? 120_000,
        });
        const rawOutput: MvpVerifierRawOutput = {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.durationMs,
            command,
            verifierType: scriptName,
        };
        const distilled = input.distill === false
            ? createUndistilledResult(rawOutput)
            : distillMvpVerifierOutput(rawOutput);

        checks.push({
            name: scriptName,
            status: distilled.passed ? 'passed' : 'failed',
            summary: distilled.summary,
            command,
            output: distilled.summary,
            exitCode: result.exitCode,
            category: distilled.category,
            locations: distilled.locations,
            rawTruncated: distilled.rawTruncated,
            originalCharCount: distilled.originalCharCount,
            summaryTokenCount: distilled.summaryTokenCount,
            compressionRatio: distilled.compressionRatio,
            issueCount: distilled.issueCount,
            coveragePercent: distilled.coveragePercent,
        });

        if (!distilled.passed) {
            break;
        }
    }

    checks.push(createMvpOutputCheck(checks));
    return finalizeVerification(checks);
}

export function formatMvpVerificationMessage(result: MvpVerificationResult): string {
    const renderedChecks = result.checks.map((check) => {
        const commandSuffix = check.command ? ` (${check.command})` : '';
        const locationSuffix = check.locations && check.locations.length > 0
            ? `\n  locations: ${check.locations
                .slice(0, 3)
                .map((location) => `${location.file}:${location.line}${location.col ? `:${location.col}` : ''}`)
                .join(', ')}`
            : '';
        const truncationSuffix = check.rawTruncated
            ? `\n  raw-output: truncated from ${check.originalCharCount ?? 0} chars`
            : '';

        return `- ${check.name}: ${check.status}${commandSuffix} — ${check.summary}${locationSuffix}${truncationSuffix}`;
    });

    return [
        result.ok ? 'Verifier status: PASSED' : 'Verifier status: FAILED',
        ...renderedChecks,
    ].join('\n');
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
        const startedAt = Date.now();
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
                command: input.command,
                exitCode: timedOut ? 1 : code ?? 1,
                stdout: stripAnsi(stdout).trim(),
                stderr: stripAnsi(stderr).trim(),
                timedOut,
                durationMs: Date.now() - startedAt,
            });
        });

        child.on('error', (error) => {
            clearTimeout(timer);
            resolve({
                command: input.command,
                exitCode: 1,
                stdout: '',
                stderr: `Failed to start verifier command: ${error.message}`,
                timedOut: false,
                durationMs: Date.now() - startedAt,
            });
        });
    });
}

function finalizeVerification(checks: MvpVerificationCheckResult[]): MvpVerificationResult {
    const failedChecks = checks.filter((check) => check.status === 'failed');
    const summary = failedChecks.length === 0
        ? 'Verifier passed.'
        : failedChecks.map((check) => `${check.name}:${check.summary}`).join(' | ');

    return {
        ok: failedChecks.length === 0,
        summary,
        digest: summary,
        checks,
    };
}

function createUndistilledResult(raw: MvpVerifierRawOutput): MvpDistilledResult {
    const combined = `${raw.stdout}\n${raw.stderr}`.trim();
    const summary = raw.exitCode === 0
        ? `${raw.verifierType} passed (${raw.durationMs}ms)`
        : truncate(combined, 800);
    const originalTokenCount = combined.split(/\s+/).filter(Boolean).length;
    const summaryTokenCount = summary.split(/\s+/).filter(Boolean).length;

    return {
        passed: raw.exitCode === 0,
        category: raw.exitCode === 0 ? 'Unknown' as const : raw.verifierType === 'test'
            ? 'TestFailure' as const
            : raw.verifierType === 'lint'
                ? 'LintError' as const
                : raw.verifierType === 'build'
                    ? 'BuildError' as const
                    : 'OutputMismatch' as const,
        summary,
        locations: [],
        rawTruncated: combined.length > 800,
        originalCharCount: combined.length,
        summaryTokenCount,
        compressionRatio: originalTokenCount === 0
            ? 1
            : Math.max(0, 1 - (summaryTokenCount / originalTokenCount)),
        issueCount: undefined,
        coveragePercent: undefined,
    };
}

function stripAnsi(value: string): string {
    return value.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, maxLength - 3)}...`;
}
