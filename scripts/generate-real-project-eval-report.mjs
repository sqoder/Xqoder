#!/usr/bin/env node

import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeRealProjectEvalReport } from './real-project-eval-report-common.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const readValue = (name, fallback) => {
    const index = argv.findIndex((token) => token === `--${name}` || token.startsWith(`--${name}=`));
    if (index === -1) {
      return fallback;
    }
    const token = argv[index];
    if (token.includes('=')) {
      return token.split('=').slice(1).join('=');
    }
    return argv[index + 1] ?? fallback;
  };

  return {
    workflowHistoryPath: path.resolve(readValue('workflow-history', path.join(os.homedir(), '.xqoder', 'data', 'workflow-history.jsonl'))),
    targetsPath: path.resolve(readValue('targets', path.join(repoRoot, 'docs', 'evals', 'real-project-targets.json'))),
    includeTemp: argv.includes('--include-temp'),
  };
}

const args = parseArgs(process.argv.slice(2));
const result = writeRealProjectEvalReport({
  projectRoot: repoRoot,
  workflowHistoryPath: args.workflowHistoryPath,
  ...(args.targetsPath ? { targetsPath: args.targetsPath } : {}),
  includeTemp: args.includeTemp,
});

process.stdout.write([
  'real project eval report written:',
  `- ${path.relative(repoRoot, result.jsonPath)}`,
  `- ${path.relative(repoRoot, result.markdownPath)}`,
  '',
].join('\n'));
