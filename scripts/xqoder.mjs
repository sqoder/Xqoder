#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Global guards — must run before ANY I/O
try { process.on('SIGPIPE', () => {}); } catch { /* platform does not support SIGPIPE */ }
process.stdin.on('error', () => {});
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

// 加载 .env（先当前目录，再脚本所在仓库根目录），不覆盖已有环境变量
function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      if (process.env[key] !== undefined) continue; // 不覆盖
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      process.env[key] = val;
    }
  } catch { /* ignore */ }
}
loadEnvFile(path.resolve(process.cwd(), '.env'));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.resolve(scriptDir, '..', '.env'));
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
