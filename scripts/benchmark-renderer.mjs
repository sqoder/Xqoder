#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeStats, ensureBuiltFiles, repoRoot, round, writeBenchmarkReport } from './benchmark-common.mjs';

function parseArgs(argv) {
  const args = new Set(argv);
  const read = (name, fallback) => {
    const index = argv.findIndex((token) => token === `--${name}` || token.startsWith(`--${name}=`));
    if (index === -1) {
      return fallback;
    }
    const token = argv[index];
    if (token.includes('=')) {
      return Number(token.split('=')[1]) || fallback;
    }
    return Number(argv[index + 1]) || fallback;
  };

  return {
    entries: Math.max(200, read('entries', 2000)),
    iterations: Math.max(5, read('iterations', 30)),
    width: Math.max(40, read('width', 96)),
    maxP95Ms: Math.max(1, read('max-p95-ms', 25)),
    maxRssMb: Math.max(64, read('max-rss-mb', 350)),
    strict: process.env.CI === 'true' || args.has('--release'),
  };
}

function createEntries(count) {
  return Array.from({ length: count }, (_, index) => {
    const role = index % 3 === 0 ? 'user' : index % 5 === 0 ? 'tool' : 'assistant';
    const content = role === 'assistant' && index % 6 === 0
      ? [
        `助手回复 ${index}：这里有一段代码块用于 transcript 渲染基准。`,
        '```ts',
        `export const value${index} = ${index};`,
        `console.log(value${index});`,
        '```',
      ].join('\n')
      : `${role} message ${index}: benchmark content for transcript rebuild and wrapping.`;

    return {
      id: `${role}-${index}`,
      role,
      content,
      timestamp: Date.now() + index,
    };
  });
}

async function loadDeps() {
  const transcriptBlocksPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'transcript-blocks.js');
  ensureBuiltFiles([transcriptBlocksPath]);
  const { rebuildTranscriptWithCodeBlocks } = await import(pathToFileURL(transcriptBlocksPath).href);
  return { rebuildTranscriptWithCodeBlocks };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { rebuildTranscriptWithCodeBlocks } = await loadDeps();
  const entries = createEntries(args.entries);
  const samples = [];
  let peakRss = process.memoryUsage().rss;
  let lastResult = null;

  for (let index = 0; index < args.iterations; index += 1) {
    const width = args.width + (index % 3) * 4;
    const started = performance.now();
    lastResult = rebuildTranscriptWithCodeBlocks(entries, width);
    const elapsed = performance.now() - started;
    samples.push(elapsed);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }

  const stats = computeStats(samples);
  const peakRssMb = round(peakRss / 1024 / 1024, 2);
  const report = {
    slug: 'render-transcript',
    title: 'Transcript Render Benchmark',
    generatedAt: new Date().toISOString(),
    summary: 'Measures transcript block rebuild latency on the real CLI render path.',
    meta: {
      entries: args.entries,
      iterations: args.iterations,
      baseWidth: args.width,
    },
    sections: [
      {
        title: 'Latency (ms)',
        metrics: {
          min: round(stats.min),
          p50: round(stats.p50),
          p95: round(stats.p95),
          avg: round(stats.avg),
          max: round(stats.max),
        },
      },
      {
        title: 'Output Shape',
        metrics: {
          lineCount: lastResult?.lines.length ?? 0,
          codeBlockCount: lastResult?.codeBlocks.length ?? 0,
          entryTotalLines: lastResult?.entryTotalLines ?? 0,
          peakRssMb,
        },
      },
    ],
    acceptance: [
      {
        label: 'Transcript rebuild p95',
        target: `< ${args.maxP95Ms}ms`,
        actual: `${round(stats.p95)}ms`,
        pass: stats.p95 <= args.maxP95Ms,
      },
      {
        label: 'Peak RSS',
        target: `< ${args.maxRssMb}MB`,
        actual: `${peakRssMb}MB`,
        pass: peakRssMb <= args.maxRssMb,
      },
    ],
  };

  const { jsonPath, markdownPath } = writeBenchmarkReport('render-transcript', report);
  process.stdout.write(`render benchmark written:\n- ${path.relative(repoRoot, jsonPath)}\n- ${path.relative(repoRoot, markdownPath)}\n`);

  if (args.strict && report.acceptance.some((entry) => !entry.pass)) {
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
