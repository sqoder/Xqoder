#!/usr/bin/env node

import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const goldenDir = path.join(repoRoot, 'docs', 'artifacts', 'golden');
const week6Dir = path.join(repoRoot, 'docs', 'artifacts', 'week6');
const stressSummaryPath = path.join(week6Dir, 'stress-messages-summary.json');
const reportPath = path.join(week6Dir, 'stability-report.md');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readGoldenArtifacts() {
  if (!fs.existsSync(goldenDir)) {
    throw new Error(`Golden artifacts directory not found: ${goldenDir}`);
  }
  const files = fs.readdirSync(goldenDir)
    .filter((name) => name.endsWith('.txt'))
    .sort();
  if (files.length === 0) {
    throw new Error('No golden snapshot files found; run pnpm golden:update first');
  }
  return files.map((name) => {
    const fullPath = path.join(goldenDir, name);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lineCount = content.split('\n').length - 1;
    return {
      name,
      lineCount,
      sha256: sha256(content),
    };
  });
}

function readStressSummary() {
  if (!fs.existsSync(stressSummaryPath)) {
    throw new Error(`Stress summary not found: ${stressSummaryPath}; run pnpm stress-test:messages first`);
  }
  const raw = fs.readFileSync(stressSummaryPath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed?.observed) {
    throw new Error('Invalid stress summary JSON: missing observed section');
  }
  return parsed;
}

function buildReport(golden, stress) {
  const now = new Date().toISOString();
  const lines = [
    '# Week6 Stability Report',
    '',
    `Generated: ${now}`,
    '',
    '## Golden Snapshot Baseline',
    '',
    '| File | Lines | SHA-256 |',
    '|---|---:|---|',
    ...golden.map((item) => `| ${item.name} | ${item.lineCount} | ${item.sha256} |`),
    '',
    '## Message Stress Summary',
    '',
    `- count: ${stress.count}`,
    `- iterations: ${stress.iterations}`,
    `- threshold p95(ms): ${stress.maxP95Ms}`,
    `- threshold max RSS(MB): ${stress.maxRssMb}`,
    `- observed p95(ms): ${stress.observed.p95Ms}`,
    `- observed mean(ms): ${stress.observed.meanMs}`,
    `- observed max(ms): ${stress.observed.maxMs}`,
    `- observed max RSS(MB): ${stress.observed.maxRssMb}`,
    `- elapsed(ms): ${stress.observed.elapsedMs}`,
    '',
    '## Gate Recommendation',
    '',
    '- Keep `verify:week6:stability` in strict release gate.',
    '- Re-run `golden:update` only when intended UI changes are reviewed.',
    '- Treat hash changes in this report as UI baseline drift requiring review.',
    '',
  ];
  return lines.join('\n');
}

function main() {
  const golden = readGoldenArtifacts();
  const stress = readStressSummary();
  fs.mkdirSync(week6Dir, { recursive: true });
  const report = buildReport(golden, stress);
  fs.writeFileSync(reportPath, report, 'utf-8');
  process.stdout.write(`✓ week6 stability report: ${path.relative(repoRoot, reportPath)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Failed to capture Week6 stability report: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
