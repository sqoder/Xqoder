/**
 * 启动路径 smoke E2E（对应 90 天计划 Day 3）：
 * - 未 build：脚本检测到入口不存在时给出明确提示并 exit 1
 * - 非 TTY：tui 在无 TTY 时给出明确提示并安全退出
 * - TUI 启动失败：见 tui.test.ts 中 renderApp 抛错时的 stderr 断言
 */
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../');
const scriptPath = path.join(repoRoot, 'scripts', 'xqoder.mjs');

describe('启动路径 smoke E2E', () => {
    it('未 build：入口不存在时 stderr 有明确提示且 exit 1', () => {
        const result = spawnSync(
            process.execPath,
            [scriptPath, '--help'],
            {
                cwd: repoRoot,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 5000,
                env: { ...process.env, XQODER_CLI_ENTRYPOINT: '/nonexistent/xqoder-cli.js' },
            },
        );

        const stderr = (result.stderr ?? '').trim();
        expect(stderr).toMatch(/未构建|CLI 入口不存在|pnpm install && pnpm build/);
        expect(result.status).toBe(1);
    });

    it('非 TTY：tui 无 TTY 时 stderr 有明确提示并安全退出', () => {
        const result = spawnSync(
            process.execPath,
            [scriptPath, 'tui'],
            {
                cwd: repoRoot,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 5000,
            },
        );

        const stderr = (result.stderr ?? '').trim();
        expect(stderr).toMatch(/TUI 需要交互式终端|TTY|交互式终端/);
        expect(result.status).toBeDefined();
        expect([0, 1]).toContain(result.status ?? -1);
    });
});
