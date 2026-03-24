#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const allowlistPath = path.join(repoRoot, 'docs', 'artifacts', 'chat-session-store-injection-allowlist.json');

const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf-8'));
const allowedPaths = new Set(
    allowlist
        .map((entry) => entry?.path)
        .filter((value) => typeof value === 'string' && value.length > 0),
);

const candidateScan = spawnSync('rg', [
    '--files-with-matches',
    '--glob',
    '**/*.ts',
    'runChatCommand|createChatCommand|runChatHeadless|runChat\\(|runNonInteractivePrompt|openChatSessionAccess|ChatServiceDependencies|ChatCommandDependencies',
    'packages/cli/src',
], {
    cwd: repoRoot,
    encoding: 'utf-8',
});

if (candidateScan.status !== 0 && candidateScan.status !== 1) {
    process.stderr.write(candidateScan.stderr || candidateScan.stdout || 'Failed to scan chat session injection call sites.\n');
    process.exit(candidateScan.status ?? 1);
}

const actualPaths = new Set(
    candidateScan.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((filePath) => {
            const absolutePath = path.join(repoRoot, filePath);
            const content = fs.readFileSync(absolutePath, 'utf-8');
            return /\bsessionStore\s*[?:]/.test(content);
        }),
);

const unexpected = [...actualPaths].filter((filePath) => !allowedPaths.has(filePath)).sort();
const stale = [...allowedPaths].filter((filePath) => !actualPaths.has(filePath)).sort();

if (unexpected.length > 0 || stale.length > 0) {
    process.stderr.write('\nChat sessionStore injection allowlist is out of sync.\n');
    if (unexpected.length > 0) {
        process.stderr.write('\nUnexpected chat sessionStore injection points:\n');
        for (const filePath of unexpected) {
            process.stderr.write(`- ${filePath}\n`);
        }
    }
    if (stale.length > 0) {
        process.stderr.write('\nStale allowlist entries to remove:\n');
        for (const filePath of stale) {
            process.stderr.write(`- ${filePath}\n`);
        }
    }
    process.stderr.write('\nUpdate docs/artifacts/chat-session-store-injection-allowlist.json so chat sessionStore injection points only shrink over time.\n');
    process.exit(1);
}

process.stdout.write(
    `Chat sessionStore injection allowlist matches current files (${actualPaths.size} remaining).\n`,
);
