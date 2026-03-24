#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDir = path.join(repoRoot, '.github', 'workflows');
const args = parseArgs(process.argv.slice(2));
const repo = args.repo ?? resolveRepoFromOrigin();

const localWorkflows = readLocalWorkflowNames(workflowsDir);
const remoteWorkflows = repo ? readRemoteWorkflowNames(repo) : [];
const remoteActiveNames = new Set(remoteWorkflows.filter((workflow) => workflow.state === 'active').map((workflow) => workflow.name));
const missingOnRemote = localWorkflows.filter((name) => !remoteActiveNames.has(name));
const remoteOnly = remoteWorkflows
  .filter((workflow) => workflow.state === 'active' && !localWorkflows.includes(workflow.name))
  .map((workflow) => workflow.name);

const report = {
  generatedAt: new Date().toISOString(),
  repo: repo ?? null,
  localWorkflowNames: localWorkflows,
  remoteActiveWorkflowNames: [...remoteActiveNames].sort((left, right) => left.localeCompare(right)),
  missingOnRemote,
  remoteOnly,
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write([
    'Workflow parity report',
    `- repo: ${report.repo ?? 'n/a'}`,
    `- local workflows: ${report.localWorkflowNames.length}`,
    `- remote active workflows: ${report.remoteActiveWorkflowNames.length}`,
    `- missing on remote: ${report.missingOnRemote.length}`,
    `- remote only: ${report.remoteOnly.length}`,
    '',
    ...(report.missingOnRemote.length > 0
      ? [
        'Missing on remote:',
        ...report.missingOnRemote.map((name) => `- ${name}`),
        '',
      ]
      : ['Missing on remote: none', '']),
    ...(report.remoteOnly.length > 0
      ? [
        'Remote only:',
        ...report.remoteOnly.map((name) => `- ${name}`),
        '',
      ]
      : ['Remote only: none', '']),
  ].join('\n'));
}

if (args.strict && report.missingOnRemote.length > 0) {
  process.exit(1);
}

function parseArgs(argv) {
  const readValue = (name) => {
    const index = argv.findIndex((token) => token === `--${name}` || token.startsWith(`--${name}=`));
    if (index === -1) {
      return undefined;
    }

    const token = argv[index];
    if (token.includes('=')) {
      return token.split('=').slice(1).join('=');
    }
    return argv[index + 1];
  };

  return {
    repo: readValue('repo'),
    strict: argv.includes('--strict'),
    json: argv.includes('--json'),
  };
}

function readLocalWorkflowNames(directory) {
  return fs.readdirSync(directory)
    .filter((entry) => entry.endsWith('.yml'))
    .map((entry) => {
      const content = fs.readFileSync(path.join(directory, entry), 'utf8');
      const match = content.match(/^name:\s+(.+)$/m);
      return match?.[1]?.trim();
    })
    .filter((value) => typeof value === 'string' && value.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function readRemoteWorkflowNames(repoSlug) {
  const output = execFileSync('gh', ['workflow', 'list', '-R', repoSlug], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const [name, state, id] = line.split('\t');
      if (!name || !state || !id) {
        return [];
      }
      return [{
        name: name.trim(),
        state: state.trim(),
        id: id.trim(),
      }];
    });
}

function resolveRepoFromOrigin() {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const httpsMatch = remote.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) {
      return `${httpsMatch[1]}/${httpsMatch[2]}`;
    }
  } catch {}

  return undefined;
}
