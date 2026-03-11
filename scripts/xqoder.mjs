#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Global guards — must run before ANY I/O
try { process.on('SIGPIPE', () => {}); } catch { /* platform does not support SIGPIPE */ }
process.stdin.on('error', () => {});
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliEntrypoint = process.env.XQODER_CLI_ENTRYPOINT
  ? path.resolve(process.env.XQODER_CLI_ENTRYPOINT)
  : path.resolve(scriptDir, '../packages/cli/dist/index.js');

if (!fs.existsSync(cliEntrypoint)) {
  console.error('[XQoder] 未构建：CLI 入口不存在。请在仓库根目录运行 pnpm install && pnpm build 后重试。');
  process.exit(1);
}

try {
  await import(pathToFileURL(cliEntrypoint).href);
} catch (err) {
  try {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[XQoder] 启动失败: ${msg}\n`);
  } catch { /* stderr broken */ }
  process.exitCode = 1;
}
