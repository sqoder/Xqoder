#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const prepareScript = path.join(repoRoot, 'scripts', 'release', 'prepare-channel.mjs');
const releaseArtifactDir = path.join(repoRoot, 'docs', 'artifacts', 'release');
const week6ReportPath = path.join(repoRoot, 'docs', 'artifacts', 'week6', 'stability-report.md');
const workflowParityScript = path.join(repoRoot, 'scripts', 'report-workflow-parity.mjs');
const releaseStateScript = path.join(repoRoot, 'scripts', 'report-release-state.mjs');
const themePrPlanScript = path.join(repoRoot, 'scripts', 'report-theme-pr-plan.mjs');
const workflowParityPath = path.join(releaseArtifactDir, 'workflow-parity.json');
const releaseStatePath = path.join(releaseArtifactDir, 'release-state.json');
const themePrPlanPath = path.join(releaseArtifactDir, 'theme-pr-plan.md');

const jobs = [
    { channel: 'rc', strict: false, out: 'docs/artifacts/release/prepare-rc.txt' },
    { channel: 'rc', strict: true, out: 'docs/artifacts/release/prepare-rc-strict.txt' },
    { channel: 'beta', strict: false, out: 'docs/artifacts/release/prepare-beta.txt' },
    { channel: 'beta', strict: true, out: 'docs/artifacts/release/prepare-beta-strict.txt' },
    { channel: 'stable', strict: false, out: 'docs/artifacts/release/prepare-stable.txt' },
    { channel: 'stable', strict: true, out: 'docs/artifacts/release/prepare-stable-strict.txt' },
];

function sha256(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

function writeReleaseIndex() {
    fs.mkdirSync(releaseArtifactDir, { recursive: true });
    const now = new Date().toISOString();
    const workflowParity = readJsonIfExists(workflowParityPath);
    const releaseState = readJsonIfExists(releaseStatePath);
    const lines = [
        '# Release Artifact Index',
        '',
        `Generated: ${now}`,
        '',
        '> Workflow parity and release state below are point-in-time snapshots from `origin`.',
        '> Refresh with `pnpm capture:release:plans` before using this page for PR or release decisions.',
        '',
        '## Release Plans',
        '',
        '| Channel | Strict | File | SHA-256 |',
        '|---|---|---|---|',
    ];

    for (const job of jobs) {
        const filePath = path.join(repoRoot, job.out);
        const hash = fs.existsSync(filePath) ? sha256(filePath) : 'MISSING';
        lines.push(`| ${job.channel} | ${job.strict ? 'yes' : 'no'} | ${job.out} | ${hash} |`);
    }

    lines.push('');
    lines.push('## Workflow Parity');
    lines.push('');
    if (workflowParity) {
        lines.push(`- file: docs/artifacts/release/workflow-parity.json`);
        lines.push(`- sha256: ${sha256(workflowParityPath)}`);
        lines.push(`- snapshot generated: ${workflowParity.generatedAt ?? 'unknown'}`);
        lines.push(`- missing on remote: ${workflowParity.missingOnRemote?.length ?? 0}`);
        if (Array.isArray(workflowParity.missingOnRemote) && workflowParity.missingOnRemote.length > 0) {
            lines.push(`- names: ${workflowParity.missingOnRemote.join(', ')}`);
        }
        lines.push(`- remote only: ${workflowParity.remoteOnly?.length ?? 0}`);
        if (Array.isArray(workflowParity.remoteOnly) && workflowParity.remoteOnly.length > 0) {
            lines.push(`- names: ${workflowParity.remoteOnly.join(', ')}`);
        }
    } else {
        lines.push('- file: docs/artifacts/release/workflow-parity.json (missing)');
        lines.push('- action: run `pnpm audit:workflow:parity` or `pnpm capture:release:plans`');
    }

    lines.push('');
    lines.push('## Release State');
    lines.push('');
    if (releaseState) {
        lines.push(`- file: docs/artifacts/release/release-state.json`);
        lines.push(`- sha256: ${sha256(releaseStatePath)}`);
        lines.push(`- snapshot generated: ${releaseState.generatedAt ?? 'unknown'}`);
        lines.push(`- reference: ${releaseState.reference ?? 'origin/main'}`);
        lines.push(`- reference commit: ${releaseState.referenceCommit ?? 'unknown'}`);
        lines.push(`- local workspace version: ${releaseState.localVersion ?? 'n/a'}`);
        lines.push(`- current version on reference: ${releaseState.currentVersion ?? 'n/a'}`);
        lines.push(`- expected stable tag: ${releaseState.stableTag ?? 'n/a'}`);
        lines.push(`- stable tag present on origin: ${releaseState.stableTagExists ? 'yes' : 'no'}`);
        lines.push(`- latest rc tag on origin: ${releaseState.latestRcTag ?? 'n/a'}`);
        lines.push(`- strict release gate available on reference: ${releaseState.strictReleaseCheckAvailable ? 'yes' : 'no'}`);
        lines.push(`- strict dry-run available on reference: ${releaseState.strictReleaseCheckDryRunAvailable ? 'yes' : 'no'}`);
        lines.push(`- strict gate ready on reference: ${releaseState.strictGateReady ? 'yes' : 'no'}`);
        if (Array.isArray(releaseState.missingGateScripts) && releaseState.missingGateScripts.length > 0) {
            lines.push(`- missing gate scripts on reference: ${releaseState.missingGateScripts.join(', ')}`);
        }
    } else {
        lines.push('- file: docs/artifacts/release/release-state.json (missing)');
        lines.push('- action: run `pnpm audit:release:state` or `pnpm capture:release:plans`');
    }

    lines.push('');
    lines.push('## Theme PR Plan');
    lines.push('');
    if (fs.existsSync(themePrPlanPath)) {
        lines.push(`- file: docs/artifacts/release/theme-pr-plan.md`);
        lines.push(`- sha256: ${sha256(themePrPlanPath)}`);
    } else {
        lines.push('- file: docs/artifacts/release/theme-pr-plan.md (missing)');
        lines.push('- action: run `pnpm audit:theme:prs` or `pnpm capture:release:plans`');
    }

    lines.push('');
    lines.push('## Week6 Stability Report');
    lines.push('');
    if (fs.existsSync(week6ReportPath)) {
        lines.push(`- file: docs/artifacts/week6/stability-report.md`);
        lines.push(`- sha256: ${sha256(week6ReportPath)}`);
    } else {
        lines.push('- file: docs/artifacts/week6/stability-report.md (missing)');
        lines.push('- action: run `pnpm capture:week6:stability` before final release review');
    }
    lines.push('');

    const indexPath = path.join(releaseArtifactDir, 'latest-index.md');
    fs.writeFileSync(indexPath, `${lines.join('\n')}\n`, 'utf-8');
    process.stdout.write(`✓ release index -> docs/artifacts/release/latest-index.md\n`);
}

function refreshQualityReports() {
    const qualityReportScript = path.join(repoRoot, 'scripts', 'generate-quality-reports.mjs');
    const result = spawnSync(process.execPath, [qualityReportScript], {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
    });
    if (result.status !== 0) {
        const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
        process.stderr.write(`Failed to refresh quality reports: ${output}\n`);
        process.exit(result.status ?? 1);
    }
    process.stdout.write('✓ refreshed docs/quality-report.md and related overview pages\n');
}

function readJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function runJsonCapture(scriptPath, outputPath) {
    const result = spawnSync(process.execPath, [scriptPath, '--json'], {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
    });
    if (result.status !== 0) {
        const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
        process.stderr.write(`Failed to capture ${path.basename(outputPath)}: ${output}\n`);
        process.exit(result.status ?? 1);
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, result.stdout, 'utf8');
    process.stdout.write(`✓ ${path.basename(outputPath)} -> ${path.relative(repoRoot, outputPath)}\n`);
}

for (const job of jobs) {
    const args = [
        prepareScript,
        '--channel',
        job.channel,
        '--pretty',
        '--write-plan',
        job.out,
    ];
    if (job.strict) {
        args.push('--strict');
    }

    const result = spawnSync(process.execPath, args, {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
    });
    if (result.status !== 0) {
        const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
        process.stderr.write(`Failed to capture ${job.channel}${job.strict ? ':strict' : ''} plan: ${output}\n`);
        process.exit(result.status ?? 1);
    }
    process.stdout.write(`✓ ${job.channel}${job.strict ? ':strict' : ''} -> ${job.out}\n`);
}

runJsonCapture(workflowParityScript, workflowParityPath);
runJsonCapture(releaseStateScript, releaseStatePath);
const themePlanResult = spawnSync(process.execPath, [themePrPlanScript, '--write', themePrPlanPath], {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30000,
});
if (themePlanResult.status !== 0) {
    const output = `${themePlanResult.stdout ?? ''}\n${themePlanResult.stderr ?? ''}`.trim();
    process.stderr.write(`Failed to capture theme-pr-plan.md: ${output}\n`);
    process.exit(themePlanResult.status ?? 1);
}
process.stdout.write(`${themePlanResult.stdout ?? ''}`);
writeReleaseIndex();
refreshQualityReports();
