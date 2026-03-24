#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const prepareScript = path.join(repoRoot, 'scripts', 'release', 'prepare-channel.mjs');

function runPrepare(args) {
    const result = spawnSync(process.execPath, [prepareScript, ...args, '--json'], {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
    });
    if (result.status !== 0) {
        const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
        throw new Error(`prepare-channel failed (${args.join(' ')}): ${output}`);
    }
    try {
        return JSON.parse(result.stdout);
    } catch (error) {
        throw new Error(`prepare-channel returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function runPrepareRaw(args) {
    const result = spawnSync(process.execPath, [prepareScript, ...args], {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
    });
    if (result.status !== 0) {
        const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
        throw new Error(`prepare-channel failed (${args.join(' ')}): ${output}`);
    }
    return result.stdout;
}

function hasCommand(payload, expected) {
    return Array.isArray(payload.commands) && payload.commands.includes(expected);
}

function buildExpectedCommands(branch, suggestedVersion, channel, strict) {
    return [
        `git checkout -b ${branch}`,
        `npm version ${suggestedVersion} --no-git-tag-version`,
        'pnpm version:sync',
        strict ? 'pnpm release:check:strict' : 'pnpm release:check',
        'pnpm parity:test',
        'git add package.json packages/*/package.json',
        `git commit -m "release: prepare ${channel} ${suggestedVersion}"`,
        `git tag v${suggestedVersion}`,
    ];
}

function assertSchema(payload, channel, strict) {
    assert.equal(payload.schemaVersion, 'release-plan.v1', `schema version mismatch for ${channel}`);
    assert.equal(typeof payload.currentVersion, 'string', `currentVersion type mismatch for ${channel}`);
    assert.equal(typeof payload.baseVersion, 'string', `baseVersion type mismatch for ${channel}`);
    assert.equal(typeof payload.suggestedVersion, 'string', `suggestedVersion type mismatch for ${channel}`);
    assert.equal(typeof payload.branch, 'string', `branch type mismatch for ${channel}`);
    assert.ok(Array.isArray(payload.commands), `commands must be array for ${channel}`);
    const expectedCommands = buildExpectedCommands(payload.branch, payload.suggestedVersion, channel, strict);
    assert.deepEqual(payload.commands, expectedCommands, `commands order/content mismatch for ${channel}`);
}

function verifyChannel(channel) {
    const normal = runPrepare(['--channel', channel]);
    assert.equal(normal.channel, channel, `normal channel mismatch for ${channel}`);
    assert.equal(normal.strict, false, `normal strict flag should be false for ${channel}`);
    assertSchema(normal, channel, false);
    assert.equal(hasCommand(normal, 'pnpm release:check'), true, `normal path should use release:check for ${channel}`);
    assert.equal(hasCommand(normal, 'pnpm release:check:strict'), false, `normal path should not use strict release check for ${channel}`);

    const strict = runPrepare(['--channel', channel, '--strict']);
    assert.equal(strict.channel, channel, `strict channel mismatch for ${channel}`);
    assert.equal(strict.strict, true, `strict flag should be true for ${channel}`);
    assertSchema(strict, channel, true);
    assert.equal(hasCommand(strict, 'pnpm release:check:strict'), true, `strict path should use release:check:strict for ${channel}`);
    assert.equal(hasCommand(strict, 'pnpm release:check'), false, `strict path should not use non-strict release check for ${channel}`);
}

for (const channel of ['rc', 'beta', 'stable']) {
    verifyChannel(channel);
    process.stdout.write(`✓ release prepare ${channel} strict routing\n`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-release-plan-'));
try {
    const planPath = path.join(tmpRoot, 'prepare-rc-plan.txt');
    const out = runPrepareRaw(['--channel', 'rc', '--pretty', '--write-plan', planPath]);
    assert.ok(out.includes('Channel: rc'), 'pretty output should include channel heading');
    assert.ok(fs.existsSync(planPath), 'write-plan should create output file');
    const planText = fs.readFileSync(planPath, 'utf-8');
    assert.ok(planText.includes('Commands:'), 'written plan should contain command section');
    process.stdout.write('✓ release prepare write-plan output\n');
} finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
}

process.stdout.write('✓ release prepare verify complete\n');
