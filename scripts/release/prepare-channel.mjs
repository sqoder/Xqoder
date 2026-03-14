#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';

const rootDir = process.cwd();
const rootPackagePath = path.join(rootDir, 'package.json');
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf-8'));

const args = parseArgs(process.argv.slice(2));
const channel = String(args.channel ?? '').trim().toLowerCase();
if (!['rc', 'beta', 'stable'].includes(channel)) {
    printHelp();
    process.exit(1);
}

const baseVersion = sanitizeVersion(String(args.baseVersion ?? rootPackage.version ?? '0.1.0'));
const suggestedVersion = suggestVersion(baseVersion, channel);
const branch = `release/${channel}-${baseVersion}`;

console.log(JSON.stringify({
    channel,
    currentVersion: rootPackage.version,
    baseVersion,
    suggestedVersion,
    branch,
    commands: [
        `git checkout -b ${branch}`,
        `npm version ${suggestedVersion} --no-git-tag-version`,
        'pnpm version:sync',
        'pnpm release:check',
        'pnpm parity:test',
        `git add package.json packages/*/package.json`,
        `git commit -m "release: prepare ${channel} ${suggestedVersion}"`,
        `git tag v${suggestedVersion}`,
    ],
}, null, 2));

function parseArgs(input) {
    const out = {};
    for (let i = 0; i < input.length; i += 1) {
        const token = input[i];
        if (!token || !token.startsWith('--')) {
            continue;
        }
        const [key, inlineValue] = token.slice(2).split('=', 2);
        if (inlineValue !== undefined) {
            out[key] = inlineValue;
            continue;
        }
        const next = input[i + 1];
        if (next && !next.startsWith('--')) {
            out[key] = next;
            i += 1;
        } else {
            out[key] = true;
        }
    }
    return out;
}

function sanitizeVersion(version) {
    const [core] = version.split('-', 2);
    if (!/^\d+\.\d+\.\d+$/.test(core)) {
        throw new Error(`Invalid version: ${version}`);
    }
    return core;
}

function suggestVersion(baseVersion, channel) {
    if (channel === 'stable') {
        return baseVersion;
    }
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
    return `${baseVersion}-${channel}.${stamp}`;
}

function printHelp() {
    console.log('Usage: node scripts/release/prepare-channel.mjs --channel rc|beta|stable [--baseVersion 0.1.0]');
}
