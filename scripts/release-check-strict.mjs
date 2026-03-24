#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');

function readOption(name) {
    const inline = argv.find((entry) => entry.startsWith(`--${name}=`));
    if (inline) {
        return inline.slice(name.length + 3);
    }
    const index = argv.indexOf(`--${name}`);
    if (index >= 0) {
        return argv[index + 1];
    }
    return undefined;
}

const checks = [
    {
        id: 'baseline',
        label: 'Baseline release chain',
        command: 'pnpm',
        args: ['release:check'],
    },
    {
        id: 'repo-hygiene',
        label: 'Repository hygiene gate',
        command: 'pnpm',
        args: ['verify:repo:hygiene'],
    },
    {
        id: 'repo-hygiene-tests',
        label: 'Repository hygiene gate tests',
        command: 'pnpm',
        args: ['verify:repo:hygiene:test'],
    },
    {
        id: 'ship-scope',
        label: 'Ship scope sanity gate',
        command: 'node',
        args: ['./scripts/verify-ship-scope.mjs'],
    },
    {
        id: 'contract-tests',
        label: 'Contract test gate',
        command: 'pnpm',
        args: ['verify:contracts'],
    },
    {
        id: 'session-recovery',
        label: 'Session recovery gate',
        command: 'pnpm',
        args: ['verify:session:recovery'],
    },
    {
        id: 'terminal-main-path',
        label: 'Terminal main-path gate',
        command: 'pnpm',
        args: ['verify:terminal:main-path'],
    },
    {
        id: 'benchmarks',
        label: 'Benchmark gate',
        command: 'node',
        args: ['./scripts/benchmark-all.mjs', '--release'],
    },
    {
        id: 'workflow-eval',
        label: 'Workflow fixture eval gate',
        command: 'pnpm',
        args: ['eval:workflow', '--release'],
    },
    {
        id: 'quality-reports',
        label: 'Quality report rendering gate',
        command: 'pnpm',
        args: ['verify:quality:reports'],
    },
    {
        id: 'release-artifacts',
        label: 'Release artifact snapshot refresh',
        command: 'pnpm',
        args: ['capture:release:plans'],
    },
    {
        id: 'renderer-contracts',
        label: 'Renderer contract gate',
        command: 'pnpm',
        args: ['verify:renderer:contracts'],
    },
    {
        id: 'session-boundary',
        label: 'Session boundary gate (no direct getSession)',
        command: 'pnpm',
        args: ['verify:session:boundary'],
    },
    {
        id: 'session-legacy-boundary',
        label: 'Session boundary gate (no legacy session compatibility APIs)',
        command: 'pnpm',
        args: ['verify:session:legacy-boundary'],
    },
    {
        id: 'session-legacy-import-boundary',
        label: 'Session boundary gate (no legacy session type/adapter imports)',
        command: 'pnpm',
        args: ['verify:session:legacy-import-boundary'],
    },
    {
        id: 'session-legacy-deep-import-boundary',
        label: 'Session boundary gate (no deep legacy session adapter imports)',
        command: 'pnpm',
        args: ['verify:session:legacy-deep-import-boundary'],
    },
    {
        id: 'session-compat-import-boundary',
        label: 'Session boundary gate (no @xqoder/agent/compat imports)',
        command: 'pnpm',
        args: ['verify:session:compat-import-boundary'],
    },
    {
        id: 'session-compat-allowlist',
        label: 'Session compat zero-plan gate (allowlist only shrinks)',
        command: 'pnpm',
        args: ['verify:session:compat-allowlist'],
    },
    {
        id: 'chat-session-store-allowlist',
        label: 'Chat sessionStore injection gate (allowlist only shrinks)',
        command: 'pnpm',
        args: ['verify:chat:session-store-allowlist'],
    },
];

const results = [];
const onlyArg = readOption('only');
const onlyIds = onlyArg
    ? new Set(onlyArg.split(',').map((entry) => entry.trim()).filter(Boolean))
    : null;
const activeChecks = onlyIds
    ? checks.filter((check) => onlyIds.has(check.id))
    : checks;

if (onlyIds) {
    const missing = [...onlyIds].filter((id) => !checks.some((check) => check.id === id));
    if (missing.length > 0) {
        process.stderr.write(`Unknown strict gate check ids: ${missing.join(', ')}\n`);
        process.exit(1);
    }
}

for (const check of activeChecks) {
    if (dryRun) {
        results.push({ ...check, status: 'skipped' });
        continue;
    }

    process.stdout.write(`\n=== ${check.label}: ${check.command} ${check.args.join(' ')} ===\n`);
    const run = spawnSync(check.command, check.args, {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'inherit',
    });

    if (run.status === 0) {
        results.push({ ...check, status: 'passed' });
        continue;
    }

    results.push({ ...check, status: 'failed', code: run.status ?? 1 });
    printChecklist(results);
    process.exit(run.status ?? 1);
}

printChecklist(results);

function printChecklist(rows) {
    process.stdout.write('\nStrict Release Gate Checklist\n');
    for (const row of activeChecks) {
        const matched = rows.find((entry) => entry.id === row.id);
        const state = matched?.status ?? 'pending';
        const badge = state === 'passed'
            ? '[PASS]'
            : state === 'failed'
                ? '[FAIL]'
                : state === 'skipped'
                    ? '[SKIP]'
                    : '[PEND]';
        process.stdout.write(`${badge} ${row.label}\n`);
    }
    if (rows.some((row) => row.status === 'failed')) {
        process.stdout.write('\nStrict release gate failed.\n');
        return;
    }
    if (dryRun) {
        process.stdout.write('\nDry-run only; no checks executed.\n');
        return;
    }
    process.stdout.write('\nAll strict release checks passed.\n');
}
