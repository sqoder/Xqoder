#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const reference = args.ref ?? 'origin/main';
const localPackageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const localVersion = String(localPackageJson.version ?? '').trim();
const referenceCommit = execGit(['rev-parse', reference]).trim();
const referencePackageJson = readJsonAtRef(reference, 'package.json');
const currentVersion = String(referencePackageJson.version ?? '').trim();
const baseVersion = stripPrerelease(currentVersion);
const stableTag = `v${baseVersion}`;
const referenceScripts = readScripts(referencePackageJson);
const requiredGateScripts = [
  'release:check',
  'release:check:strict',
  'release:check:strict:dry-run',
  'capture:release:plans',
  'verify:contracts',
  'verify:session:recovery',
  'verify:terminal:main-path',
  'verify:release:blockers',
];
const availableGateScripts = requiredGateScripts.filter((name) => Object.hasOwn(referenceScripts, name));
const missingGateScripts = requiredGateScripts.filter((name) => !Object.hasOwn(referenceScripts, name));
const strictReleaseCheckAvailable = Object.hasOwn(referenceScripts, 'release:check:strict');
const strictReleaseCheckDryRunAvailable = Object.hasOwn(referenceScripts, 'release:check:strict:dry-run');
const strictGateReady = missingGateScripts.length === 0;

const remoteTags = execGit(['ls-remote', '--tags', 'origin'])
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .map((line) => line.split('\t')[1]?.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, ''))
  .filter((tag) => typeof tag === 'string' && tag.length > 0);

const uniqueRemoteTags = [...new Set(remoteTags)];
const rcTags = uniqueRemoteTags.filter((tag) => tag.startsWith(`${stableTag}-rc.`)).sort();
const stableTagExists = uniqueRemoteTags.includes(stableTag);

const report = {
  generatedAt: new Date().toISOString(),
  reference,
  referenceCommit,
  localVersion,
  currentVersion,
  baseVersion,
  stableTag,
  stableTagExists,
  rcTags,
  latestRcTag: rcTags[rcTags.length - 1] ?? null,
  strictReleaseCheckAvailable,
  strictReleaseCheckDryRunAvailable,
  strictGateReady,
  availableGateScripts,
  missingGateScripts,
  versionDrift: localVersion !== currentVersion,
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write([
    'Release state report',
    `- reference: ${report.reference}`,
    `- reference commit: ${report.referenceCommit}`,
    `- local workspace version: ${report.localVersion}`,
    `- current version: ${report.currentVersion}`,
    `- base version: ${report.baseVersion}`,
    `- expected stable tag: ${report.stableTag}`,
    `- stable tag present on origin: ${report.stableTagExists ? 'yes' : 'no'}`,
    `- latest rc tag on origin: ${report.latestRcTag ?? 'n/a'}`,
    `- strict release gate available on reference: ${report.strictReleaseCheckAvailable ? 'yes' : 'no'}`,
    `- strict dry-run available on reference: ${report.strictReleaseCheckDryRunAvailable ? 'yes' : 'no'}`,
    `- strict gate ready on reference: ${report.strictGateReady ? 'yes' : 'no'}`,
    `- missing gate scripts on reference: ${report.missingGateScripts.length > 0 ? report.missingGateScripts.join(', ') : 'none'}`,
    `- remote rc tags: ${report.rcTags.length}`,
    '',
  ].join('\n'));
}

if (args.strict && !report.stableTagExists) {
  process.exit(1);
}

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    ref: readOption(argv, 'ref'),
    strict: argv.includes('--strict'),
  };
}

function readOption(argv, name) {
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

function execGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function readJsonAtRef(ref, filePath) {
  return JSON.parse(execGit(['show', `${ref}:${filePath}`]));
}

function readScripts(packageJson) {
  const value = packageJson?.scripts;
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value;
}

function stripPrerelease(version) {
  const normalized = String(version ?? '').trim();
  return normalized.split('-')[0] ?? normalized;
}
