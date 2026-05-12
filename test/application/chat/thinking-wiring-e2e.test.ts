import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { CompletionRequest } from '@xqoder/llm-api';
import { XQoderAgent } from '../../../src/core/agent/agent.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-p20b-e2e-'));
    tempDirs.push(dir);
    return dir;
}

describe('P20b — thinking config reaches provider request', () => {
    it('passes resolved ThinkingConfig to provider.stream() as request.thinking', async () => {
        const cwd = createTempDir();
        const captured: CompletionRequest[] = [];
        const agent = new XQoderAgent({
            llmConfig: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: 'test-key' },
            cwd,
            projectRoot: cwd,
            permissions: { defaultMode: 'allow', tools: {} },
            thinking: { mode: 'enabled', effort: 'high', fastMode: 'fast' },
            providerFactory: async () => ({
                name: 'anthropic',
                model: 'claude-sonnet-4-20250514',
                async complete() { throw new Error('not used'); },
                async stream(request) {
                    captured.push(request);
                    return {
                        finishReason: 'stop' as const,
                        message: { role: 'assistant' as const, content: 'ok' },
                        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
                    };
                },
            }),
        });

        await agent.run('hi');

        expect(captured).toHaveLength(1);
        const thinking = captured[0]!.thinking;
        expect(thinking).toBeDefined();
        expect(thinking!.mode).toBe('enabled');
        expect(thinking!.effort).toBe('high');
        expect(thinking!.fastMode).toBe('fast');
        expect(thinking!.budgetTokens).toBe(16_000);
    });

    it('omits thinking when agent config has no override', async () => {
        const cwd = createTempDir();
        const captured: CompletionRequest[] = [];
        const agent = new XQoderAgent({
            llmConfig: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
            cwd,
            projectRoot: cwd,
            permissions: { defaultMode: 'allow', tools: {} },
            providerFactory: async () => ({
                name: 'openai',
                model: 'gpt-4o',
                async complete() { throw new Error('not used'); },
                async stream(request) {
                    captured.push(request);
                    return {
                        finishReason: 'stop' as const,
                        message: { role: 'assistant' as const, content: 'ok' },
                        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
                    };
                },
            }),
        });

        await agent.run('hi');

        expect(captured).toHaveLength(1);
        expect(captured[0]!.thinking).toBeUndefined();
    });

    it('applies model family defaults when only effort is overridden', async () => {
        const cwd = createTempDir();
        const captured: CompletionRequest[] = [];
        const agent = new XQoderAgent({
            llmConfig: { provider: 'openai', model: 'o1', apiKey: 'test-key' },
            cwd,
            projectRoot: cwd,
            permissions: { defaultMode: 'allow', tools: {} },
            thinking: { effort: 'xhigh' },
            providerFactory: async () => ({
                name: 'openai',
                model: 'o1',
                async complete() { throw new Error('not used'); },
                async stream(request) {
                    captured.push(request);
                    return {
                        finishReason: 'stop' as const,
                        message: { role: 'assistant' as const, content: 'ok' },
                        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
                    };
                },
            }),
        });

        await agent.run('hi');

        // o1 family defaults to mode=enabled; user override sets effort=xhigh
        expect(captured[0]!.thinking?.mode).toBe('enabled');
        expect(captured[0]!.thinking?.effort).toBe('xhigh');
        expect(captured[0]!.thinking?.budgetTokens).toBe(32_000);
    });
});
