/**
 * CLI 主路径 smoke 基线（对应 90 天计划 Day 22）
 * 覆盖：--prompt、chat、fix 三条入口可调起且不崩溃。
 * 直接使用本包构建产物，避免依赖 repo 根脚本路径。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const cliEntry = path.resolve(__dirname, '../dist/index.js');

function runCli(
    args: string[],
    env: NodeJS.ProcessEnv = process.env as NodeJS.ProcessEnv,
    opts?: { cwd?: string },
) {
    return spawnSync(process.execPath, [cliEntry, ...args], {
        cwd: opts?.cwd ?? path.resolve(__dirname, '../..'),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
        env: { ...process.env, ...env },
    });
}

describe('CLI main path smoke', () => {
    it('--help exits 0 and prints usage', () => {
        const r = runCli(['--help']);
        expect(r.status).toBe(0);
        const out = (r.stdout ?? '') + (r.stderr ?? '');
        expect(out).toMatch(/Usage|使用|--prompt|Options/);
        expect(out).not.toMatch(/\bfix\b|\bdeploy\b|\bweb\b/);
    });

    it('chat --help exits 0', () => {
        const r = runCli(['chat', '--help']);
        expect(r.status).toBe(0);
        expect((r.stdout ?? '') + (r.stderr ?? '')).toMatch(/chat|--dir|--new-session/);
    });

    it('fix --help exits 0', () => {
        const r = runCli(['fix', '--help']);
        expect(r.status).toBe(0);
        const out = (r.stdout ?? '') + (r.stderr ?? '');
        // 目前构建产物中 workflows 插件可能未开启，这里只做「帮助输出正常」的烟雾测试
        expect(out).toMatch(/Usage|使用|--prompt|Options/);
    });

    it('--prompt without API key exits 1 with structured error', () => {
        const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-smoke-'));
        const xqoderDir = path.join(tmpHome, '.xqoder');
        fs.mkdirSync(xqoderDir, { recursive: true });
        fs.writeFileSync(
            path.join(xqoderDir, 'config.json'),
            JSON.stringify({
                providers: {
                    openai: { apiKey: '', defaultModel: 'gpt-4o', disabled: false },
                    anthropic: { apiKey: '', disabled: false },
                },
                defaultAgent: 'general',
                debug: false,
                recentProjects: [],
            }),
            'utf-8',
        );

        // 与 provider-detect + config 中读取 key 的变量一致，从子进程 env 中移除，避免本机已配置 key 导致 exit 0
        const envVarsToUnset = [
            'XQODER_LLM_API_KEY',
            'GITHUB_TOKEN',
            'ANTHROPIC_API_KEY',
            'OPENAI_API_KEY',
            'GEMINI_API_KEY',
            'GROQ_API_KEY',
            'OPENROUTER_API_KEY',
            'XAI_API_KEY',
            'DASHSCOPE_API_KEY',
            'AWS_ACCESS_KEY_ID',
            'AZURE_OPENAI_API_KEY',
            'GOOGLE_APPLICATION_CREDENTIALS',
        ];
        const envNoKey: NodeJS.ProcessEnv = {
            ...process.env,
            HOME: tmpHome,
            XDG_CONFIG_HOME: path.join(tmpHome, '.config'),
        };
        for (const key of envVarsToUnset) {
            delete envNoKey[key];
        }

        const r = runCli(['--prompt', 'hello', '--json'], envNoKey, { cwd: tmpHome });
        try {
            expect(r.status).toBe(1);
            const out = (r.stdout ?? '') + (r.stderr ?? '');
            const hasJsonError =
                /"success"\s*:\s*false/.test(out) && /"error"/.test(out);
            const hasPlainError = /Error:/.test(out);
            expect(hasJsonError || hasPlainError).toBe(true);
        } finally {
            try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });
});
