#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectThemePrPlan,
  renderThemePrPlanMarkdown,
} from './theme-pr-plan-common.mjs';

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const report = inspectThemePrPlan({
  repoRoot: args.repoRoot ?? defaultRepoRoot,
  ...(args.baseRef ? { baseRef: args.baseRef } : {}),
});

if (args.json) {
  const payload = `${JSON.stringify(report, null, 2)}\n`;
  if (args.writePath) {
    fs.mkdirSync(path.dirname(args.writePath), { recursive: true });
    fs.writeFileSync(args.writePath, payload, 'utf8');
  } else {
    process.stdout.write(payload);
  }
  process.exit(0);
}

const markdown = renderThemePrPlanMarkdown(report);
if (args.writePath) {
  fs.mkdirSync(path.dirname(args.writePath), { recursive: true });
  fs.writeFileSync(args.writePath, markdown, 'utf8');
  process.stdout.write(`✓ theme PR plan -> ${path.relative(args.repoRoot ?? defaultRepoRoot, args.writePath)}\n`);
} else {
  process.stdout.write(markdown);
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
      continue;
    }
    if (token === '--write') {
      options.writePath = argv[index + 1];
      index += 1;
    }
  }
  return options;
}
