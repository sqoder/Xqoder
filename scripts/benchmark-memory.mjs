#!/usr/bin/env node

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
    count: Math.max(200, read('count', 3000)),
    iterations: Math.max(20, read('iterations', 180)),
    warmupIterations: Math.max(0, read('warmup-iterations', 40)),
    settleMs: Math.max(0, read('settle-ms', 25)),
    maxPeakRssMb: Math.max(64, read('max-peak-rss-mb', 220)),
    maxP95Ms: Math.max(1, read('max-p95-ms', 16)),
    strict: process.env.CI === 'true' || args.has('--release'),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function settleRuntime(ms) {
  const maybeGc = globalThis.gc;
  if (typeof maybeGc === 'function') {
    maybeGc();
    await sleep(0);
    maybeGc();
  }
  if (ms > 0) {
    await sleep(ms);
  }
}

async function loadDeps() {
  const appStatePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'app-state.js');
  const runtimeBridgePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'runtime-bridge.js');
  const reducerPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-app', 'reducer.js');
  const rendererPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'renderer.js');
  ensureBuiltFiles([appStatePath, runtimeBridgePath, reducerPath, rendererPath]);

  const [
    { createInitialTerminalAppState },
    { withDerivedChrome },
    { reduceTerminalAppState },
    { renderTerminalFrame },
  ] = await Promise.all([
    import(pathToFileURL(appStatePath).href),
    import(pathToFileURL(runtimeBridgePath).href),
    import(pathToFileURL(reducerPath).href),
    import(pathToFileURL(rendererPath).href),
  ]);

  return { createInitialTerminalAppState, withDerivedChrome, reduceTerminalAppState, renderTerminalFrame };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.env.XQODER_RENDERER_SINK_OUTPUT = '1';
  const { createInitialTerminalAppState, withDerivedChrome, reduceTerminalAppState, renderTerminalFrame } = await loadDeps();

  let state = createInitialTerminalAppState({ width: 140, height: 36 });
  state.transcriptEntries = Array.from({ length: args.count }, (_, index) => {
    const isUser = index % 2 === 0;
    return {
      id: `${isUser ? 'u' : 'a'}-${index}`,
      role: isUser ? 'user' : 'assistant',
      content: isUser
        ? `用户消息 ${index}：这是内存 benchmark。`
        : `助手回复 ${index}：用于测量 transcript 长会话下的 RSS 和帧时延。`,
    };
  });
  state = withDerivedChrome(state);

  await settleRuntime(args.settleMs);

  let baseline = process.memoryUsage();
  let peakRss = baseline.rss;
  let peakHeap = baseline.heapUsed;
  const frameDurations = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;

  try {
    for (let index = 0; index < args.warmupIterations; index += 1) {
      state = reduceTerminalAppState(state, { type: 'viewport.scroll', delta: index % 2 === 0 ? 3 : -2 });
      renderTerminalFrame(state);
      const usage = process.memoryUsage();
      peakRss = Math.max(peakRss, usage.rss);
      peakHeap = Math.max(peakHeap, usage.heapUsed);
    }

    await settleRuntime(args.settleMs);
    baseline = process.memoryUsage();
    peakRss = baseline.rss;
    peakHeap = baseline.heapUsed;

    for (let index = 0; index < args.iterations; index += 1) {
      state = reduceTerminalAppState(state, { type: 'viewport.scroll', delta: index % 2 === 0 ? 3 : -2 });
      const started = performance.now();
      renderTerminalFrame(state);
      const duration = performance.now() - started;
      frameDurations.push(duration);
      const usage = process.memoryUsage();
      peakRss = Math.max(peakRss, usage.rss);
      peakHeap = Math.max(peakHeap, usage.heapUsed);
    }
  } finally {
    process.stdout.write = originalWrite;
  }

  const latency = computeStats(frameDurations);
  const baselineRssMb = round(baseline.rss / 1024 / 1024, 2);
  const peakRssMb = round(peakRss / 1024 / 1024, 2);
  const peakHeapMb = round(peakHeap / 1024 / 1024, 2);
  const rssDeltaMb = round((peakRss - baseline.rss) / 1024 / 1024, 2);
  const report = {
    slug: 'memory-transcript',
    title: 'Transcript Memory Benchmark',
    generatedAt: new Date().toISOString(),
    summary: 'Measures RSS and frame latency while scrolling a large transcript on the real CLI state/render path with terminal device flush suppressed for stable CI gating.',
    meta: {
      transcriptEntries: args.count,
      iterations: args.iterations,
      warmupIterations: args.warmupIterations,
      settleMs: args.settleMs,
    },
    sections: [
      {
        title: 'Memory (MB)',
        metrics: {
          baselineRssMb,
          peakRssMb,
          rssDeltaMb,
          peakHeapMb,
        },
      },
      {
        title: 'Frame Latency (ms)',
        metrics: {
          min: round(latency.min),
          p50: round(latency.p50),
          p95: round(latency.p95),
          avg: round(latency.avg),
          max: round(latency.max),
        },
      },
    ],
    acceptance: [
      {
        label: 'Peak RSS',
        target: `< ${args.maxPeakRssMb}MB`,
        actual: `${peakRssMb}MB`,
        pass: peakRssMb <= args.maxPeakRssMb,
      },
      {
        label: 'Frame p95',
        target: `< ${args.maxP95Ms}ms`,
        actual: `${round(latency.p95)}ms`,
        pass: latency.p95 <= args.maxP95Ms,
      },
    ],
  };

  const { jsonPath, markdownPath } = writeBenchmarkReport('memory-transcript', report);
  process.stdout.write(`memory benchmark written:\n- ${path.relative(repoRoot, jsonPath)}\n- ${path.relative(repoRoot, markdownPath)}\n`);

  if (args.strict && report.acceptance.some((entry) => !entry.pass)) {
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
