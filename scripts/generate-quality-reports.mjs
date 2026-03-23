#!/usr/bin/env node

import * as path from 'node:path';
import { writeQualityOverviewReports } from './quality-report-common.mjs';

function parseArgs(argv) {
  const index = argv.findIndex((token) => token === '--project-root' || token.startsWith('--project-root='));
  if (index === -1) {
    return {};
  }

  const token = argv[index];
  if (token.includes('=')) {
    return { projectRoot: token.split('=').slice(1).join('=') };
  }

  return { projectRoot: argv[index + 1] };
}

const args = parseArgs(process.argv.slice(2));
const result = writeQualityOverviewReports(args);

process.stdout.write([
  'quality overview written:',
  `- ${path.relative(process.cwd(), result.rootOverviewPath)}`,
  `- ${path.relative(process.cwd(), result.benchmarkOverviewPath)}`,
  `- ${path.relative(process.cwd(), result.evalOverviewPath)}`,
  `- ${path.relative(process.cwd(), result.comparisonPath)}`,
  '- docs/evals/real-project-results.md',
  '',
].join('\n'));
