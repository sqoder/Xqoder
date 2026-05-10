import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import type { HooksSettings } from '@xqoder/shared';
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-lifecycle-wire-'));
    tempDirs.push(dir);
    return dir;
}

function touchHook(markerPath: string, extra = ''): HooksSettings[keyof HooksSettings] {
    return [
        {
            hooks: [
                {
                    type: 'command',
                    command: `cat >/dev/null; printf '%s' 'fired' >> '${markerPath}'${extra}`,
                },
            ],
        },
    ];
}

async function waitForMarker(markerPath: string, timeoutMs = 2000): Promise<string | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (fs.existsSync(markerPath)) {
            return fs.readFileSync(markerPath, 'utf-8');
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return undefined;
}

describe('lifecycle hooks wired into XQoderAgent (P14b)', () => {
    it('fires SessionStart and Stop hooks around a conversation turn', async () => {
        const cwd = createTempDir();
        const sessionMarker = path.join(cwd, 'session-start.txt');
        const stopMarker = path.join(cwd, 'stop.txt');

        const hooks: HooksSettings = {
            SessionStart: touchHook(sessionMarker),
            Stop: touchHook(stopMarker),
        };

        const agent = new XQoderAgent({
            llmConfig: { provider: 'openai', model: 'test-model', apiKey: 'test-key' },
            cwd,
            projectRoot: cwd,
            permissions: { defaultMode: 'allow', tools: {} },
            hooks,
            providerFactory: async () => ({
                name: 'lifecycle-provider',
                model: 'lifecycle-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    return {
                        finishReason: 'stop' as const,
                        message: { role: 'assistant' as const, content: 'hello' },
                        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
                    };
                },
            }),
        });

        const result = await agent.run('hi');
        expect(result).toBe('hello');

        const sessionContent = fs.readFileSync(sessionMarker, 'utf-8');
        expect(sessionContent).toBe('fired');

        const stopContent = await waitForMarker(stopMarker);
        expect(stopContent).toBe('fired');
    });

    it('blocks the turn when SessionStart hook denies with decision=block', async () => {
        const cwd = createTempDir();
        const hooks: HooksSettings = {
            SessionStart: [
                {
                    hooks: [
                        {
                            type: 'command',
                            command: `cat >/dev/null; printf '%s' '${JSON.stringify({ decision: 'block', reason: 'session blocked' })}'`,
                        },
                    ],
                },
            ],
        };

        let streamCalls = 0;
        const agent = new XQoderAgent({
            llmConfig: { provider: 'openai', model: 'test-model', apiKey: 'test-key' },
            cwd,
            projectRoot: cwd,
            permissions: { defaultMode: 'allow', tools: {} },
            hooks,
            providerFactory: async () => ({
                name: 'blocked-provider',
                model: 'blocked-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    streamCalls += 1;
                    return {
                        finishReason: 'stop' as const,
                        message: { role: 'assistant' as const, content: 'should not run' },
                        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                    };
                },
            }),
        });

        let caught: unknown;
        try {
            await agent.run('hi');
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeDefined();
        expect(streamCalls).toBe(0);
        expect((caught as Error).message).toContain('session blocked');
    });

    it('skips lifecycle hooks when disableAllHooks is true', async () => {
        const cwd = createTempDir();
        const sessionMarker = path.join(cwd, 'session-start.txt');

        const hooks: HooksSettings = {
            SessionStart: touchHook(sessionMarker),
        };

        const agent = new XQoderAgent({
            llmConfig: { provider: 'openai', model: 'test-model', apiKey: 'test-key' },
            cwd,
            projectRoot: cwd,
            permissions: { defaultMode: 'allow', tools: {} },
            hooks,
            disableAllHooks: true,
            providerFactory: async () => ({
                name: 'disabled-provider',
                model: 'disabled-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    return {
                        finishReason: 'stop' as const,
                        message: { role: 'assistant' as const, content: 'ok' },
                        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
                    };
                },
            }),
        });

        const result = await agent.run('hi');
        expect(result).toBe('ok');
        expect(fs.existsSync(sessionMarker)).toBe(false);
    });
});
