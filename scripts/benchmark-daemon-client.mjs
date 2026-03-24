#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import * as os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { getRuntimePaths } from './runtime-paths.mjs';
import { computeStats, formatMetric, repoRoot, round, writeBenchmarkReport } from './benchmark-common.mjs';

const args = new Set(process.argv.slice(2));
const strict = process.env.CI === 'true' || args.has('--release');
const clientBin = process.env.XQODER_CLIENT_BIN
  ? path.resolve(process.env.XQODER_CLIENT_BIN)
  : path.resolve(repoRoot, 'packages/client/target/release/xqoder');
const daemonEntry = process.env.XQODER_DAEMON
  ? path.resolve(process.env.XQODER_DAEMON)
  : path.resolve(repoRoot, 'packages/daemon/dist/server.js');
const benchmarkRunBaseDir = process.env.XQODER_RUN_BASE_DIR
  ? path.resolve(process.env.XQODER_RUN_BASE_DIR)
  : path.join(os.tmpdir(), 'xqoder-benchmark-run');
process.env.XQODER_RUN_BASE_DIR = benchmarkRunBaseDir;
const runtimePaths = getRuntimePaths();
const socketPath = runtimePaths.socketPath;
const readyPath = runtimePaths.readyFilePath;
const daemonReadyTimeoutMs = Number(process.env.XQODER_DAEMON_READY_TIMEOUT_MS ?? (strict ? 15000 : 10000));
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleep(ms) {
  Atomics.wait(sleepBuffer, 0, 0, ms);
}

function cleanupRuntimeArtifacts() {
  try { fs.unlinkSync(readyPath); } catch {}
  try { fs.unlinkSync(runtimePaths.pidFilePath); } catch {}
  try { fs.unlinkSync(socketPath); } catch {}
}

function measureClientVersion(warmRuns = 40) {
  const runOnce = () => {
    const start = process.hrtime.bigint();
    const result = spawnSync(clientBin, ['--version'], { stdio: 'ignore' });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    if (result.status !== 0) {
      throw new Error(`client --version failed with status ${result.status}`);
    }
    return elapsedMs;
  };

  const cold = runOnce();
  const warmSamples = [];
  for (let i = 0; i < warmRuns; i += 1) {
    warmSamples.push(runOnce());
  }
  return { cold, warm: computeStats(warmSamples) };
}

function waitForReady(daemon, timeoutMs = daemonReadyTimeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(readyPath)) {
      return true;
    }
    if (daemon.exitCode !== null || daemon.killed) {
      return false;
    }
    sleep(20);
  }
  return false;
}

async function measureDaemonReady(runs = 30) {
  cleanupRuntimeArtifacts();
  const daemon = spawn(process.execPath, [daemonEntry], {
    stdio: 'ignore',
    env: {
      ...process.env,
      XQODER_NODE: process.execPath,
      XQODER_WORKSPACE_ROOT: runtimePaths.workspaceRoot,
      XQODER_RUN_BASE_DIR: benchmarkRunBaseDir,
    },
  });

  if (!waitForReady(daemon)) {
    daemon.kill('SIGTERM');
    throw new Error('daemon did not become ready in time');
  }

  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const elapsed = await new Promise((resolve, reject) => {
      const start = process.hrtime.bigint();
      const socket = net.connect(socketPath);
      let done = false;
      socket.on('data', () => {
        if (done) return;
        done = true;
        const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
        socket.end();
        resolve(ms);
      });
      socket.on('error', (err) => {
        if (done) return;
        done = true;
        reject(err);
      });
    });
    samples.push(elapsed);
  }

  daemon.kill('SIGTERM');
  await new Promise((resolve) => daemon.once('exit', resolve));
  cleanupRuntimeArtifacts();
  return computeStats(samples);
}

async function main() {
  if (!fs.existsSync(clientBin)) {
    throw new Error(`client binary not found: ${clientBin}`);
  }
  if (!fs.existsSync(daemonEntry)) {
    throw new Error(`daemon entry not found: ${daemonEntry}`);
  }

  const clientStats = measureClientVersion();
  const daemonStats = await measureDaemonReady();
  const now = new Date().toISOString();
  const report = {
    slug: 'daemon-startup',
    title: 'Daemon/Client Startup Benchmark',
    generatedAt: now,
    summary: 'Rust client cold/warm startup and daemon warm attach latency.',
    meta: {
      clientBinary: clientBin,
      daemonEntry,
      strictMode: strict,
    },
    sections: [
      {
        title: 'Rust Client Startup (ms)',
        metrics: {
          cold: round(clientStats.cold),
          warmMin: round(clientStats.warm.min),
          warmP50: round(clientStats.warm.p50),
          warmP95: round(clientStats.warm.p95),
          warmAvg: round(clientStats.warm.avg),
          warmMax: round(clientStats.warm.max),
        },
      },
      {
        title: 'Daemon Warm Attach (ms)',
        metrics: {
          min: round(daemonStats.min),
          p50: round(daemonStats.p50),
          p95: round(daemonStats.p95),
          avg: round(daemonStats.avg),
          max: round(daemonStats.max),
        },
      },
    ],
    acceptance: [
      {
        label: 'Client warm startup p95',
        target: '< 10ms',
        actual: `${round(clientStats.warm.p95)}ms`,
        pass: clientStats.warm.p95 < 10,
      },
      {
        label: 'Daemon warm attach p95',
        target: '< 10ms',
        actual: `${round(daemonStats.p95)}ms`,
        pass: daemonStats.p95 < 10,
      },
    ],
  };
  const { jsonPath, markdownPath } = writeBenchmarkReport('daemon-startup', report);
  process.stdout.write(`# ${report.title}\n`);
  process.stdout.write(`- JSON: ${path.relative(repoRoot, jsonPath)}\n`);
  process.stdout.write(`- Markdown: ${path.relative(repoRoot, markdownPath)}\n`);
  for (const section of report.sections) {
    process.stdout.write(`\n## ${section.title}\n`);
    for (const [key, value] of Object.entries(section.metrics)) {
      process.stdout.write(`- ${key}: ${formatMetric(value)}\n`);
    }
  }

  const clientPass = clientStats.warm.p95 < 10;
  const daemonPass = daemonStats.p95 < 10;
  if (strict && (!clientPass || !daemonPass)) {
    process.exit(1);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
