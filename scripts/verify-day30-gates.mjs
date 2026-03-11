#!/usr/bin/env node
/**
 * Day 30 阶段门槛验证脚本（执行计划 § Day 30 的 4 件事）
 * 必须全部通过才视为「全部没问题」；建议 CI 与发布前运行。
 *
 * 用法: node scripts/verify-day30-gates.mjs
 * 依赖: 需先 pnpm build（门槛1 会测未构建提示；门槛4 会跑全量 test 含 smoke）
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'xqoder.mjs');
const cliEntry = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');

function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: opts.timeout ?? 60000,
        ...opts,
    });
    return r;
}

const gates = [
    [
        '门槛1: 启动失败时提示明确',
        () => {
            const r = run(process.execPath, [scriptPath, '--help'], {
                env: { ...process.env, XQODER_CLI_ENTRYPOINT: '/nonexistent/entry.js' },
            });
            const stderr = (r.stderr ?? '').trim();
            if (r.status !== 1) throw new Error(`期望 exit 1，得到 ${r.status}`);
            if (!/未构建|CLI 入口不存在|pnpm install|pnpm build/i.test(stderr)) {
                throw new Error('stderr 应含未构建/CLI 入口提示');
            }
            const r2 = run(process.execPath, [scriptPath, 'tui'], { env: process.env });
            const stderr2 = (r2.stderr ?? '').trim();
            if (!/TUI 需要|TTY|交互式终端/i.test(stderr2)) {
                throw new Error('非 TTY 时 stderr 应含 TUI/TTY 提示');
            }
        },
    ],
    [
        '门槛2: 高风险文件写入（file-tools 审批测试）',
        () => {
            const r = run('pnpm', ['--filter', '@xqoder/agent', 'exec', 'vitest', 'run', 'src/tools/file-tools.test.ts'], {});
            if (r.status !== 0) throw new Error(`file-tools 测试 exit ${r.status}`);
        },
    ],
    [
        '门槛3: session/secret（auth+config 测试）',
        () => {
            const rAuth = run('pnpm', ['--filter', '@xqoder/cli', 'exec', 'vitest', 'run', 'src/commands/auth.test.ts'], {});
            if (rAuth.status !== 0) throw new Error('auth 测试失败');
            const rConfig = run('pnpm', ['--filter', '@xqoder/shared', 'exec', 'vitest', 'run', 'src/config.test.ts'], {});
            if (rConfig.status !== 0) throw new Error('config 测试失败');
        },
    ],
    [
        '门槛4: 测试假绿（全量 test + CLI smoke）',
        () => {
            const r = run('pnpm', ['test'], { timeout: 180000 });
            if (r.status !== 0) {
                const out = (r.stdout ?? '') + (r.stderr ?? '');
                const tail = out.trim().split('\n').slice(-80).join('\n');
                console.error('\n--- pnpm test 失败，末尾输出 ---\n');
                console.error(tail || '(无输出)');
                console.error('\n--- 完整定位请直接运行: pnpm test ---\n');
                throw new Error(`pnpm test exit ${r.status}`);
            }
            if (!fs.existsSync(cliEntry)) throw new Error('CLI 未 build，请先 pnpm build');
            const rSmoke = run('pnpm', ['--filter', '@xqoder/cli', 'exec', 'vitest', 'run', 'src/cli.main-path.smoke.test.ts'], {});
            if (rSmoke.status !== 0) throw new Error('CLI 主路径 smoke 失败');
        },
    ],
];

let failedCount = 0;
for (const [name, fn] of gates) {
    try {
        fn();
        console.log(`[PASS] ${name}`);
    } catch (e) {
        console.error(`[FAIL] ${name}: ${e.message}`);
        failedCount++;
    }
}

if (failedCount > 0) {
    console.error(`\n共 ${failedCount} 项未通过，Day 30 门槛未达成。`);
    process.exit(1);
}
console.log('\nDay 30 四项门槛全部通过。');
