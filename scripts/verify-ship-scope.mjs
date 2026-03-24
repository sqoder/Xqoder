#!/usr/bin/env node

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hasShipScopeIssues,
  inspectShipScope,
  printShipScopeReport,
} from './ship-scope-common.mjs';

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = parseArgs(process.argv.slice(2));
const report = inspectShipScope({
  repoRoot: args.repoRoot ?? defaultRepoRoot,
  ...(args.baseRef ? { baseRef: args.baseRef } : {}),
});

if (args.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  printShipScopeReport(report);
}

if (hasShipScopeIssues(report)) {
  process.exitCode = 1;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token === '--base') {
      options.baseRef = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--repo-root') {
      options.repoRoot = argv[index + 1];
      index += 1;
    }
  }
  return options;
}
