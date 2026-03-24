#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const forwardArgs = process.argv.slice(2);
const cooldownMs = Number(process.env.XQODER_BENCHMARK_COOLDOWN_MS ?? 300);

const commands = [
  ['benchmark:startup', ['pnpm', ['benchmark:startup']]],
  ['benchmark:memory', ['pnpm', ['benchmark:memory']]],
  ['benchmark:render', ['pnpm', ['benchmark:render']]],
  ['benchmark:workflow', ['pnpm', ['benchmark:workflow']]],
];

function stripAnsi(text) {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function summarizeOutput(output) {
  const lines = stripAnsi(output)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  return lines.filter((line) => /^(# |## |- JSON:|- Markdown:|render benchmark written:|memory benchmark written:|workflow benchmark written:|- docs\/benchmarks\/|- cold:|- warm|- min:|- p50:|- p95:|- avg:|- max:)/.test(line));
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

commands.forEach(([label, [cmd, args]], index) => {
  process.stdout.write(`\n== ${label} ==\n`);
  const result = spawnSync(cmd, [...args, ...forwardArgs], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  const summaryLines = summarizeOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (summaryLines.length > 0) {
    process.stdout.write(`${summaryLines.join('\n')}\n`);
  }
  if (cooldownMs > 0 && index < commands.length - 1) {
    sleep(cooldownMs);
  }
});
