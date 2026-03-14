import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { XQoderAgent } from './agent.js';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-agent-perm-'));
    tempDirs.push(dir);
    return dir;
}

function createToolCallProvider(fileName: string, content: string) {
    let iteration = 0;
    return {
        name: 'fake',
        model: 'fake-model',
        complete: async () => {
            iteration += 1;
            if (iteration === 1) {
                return {
                    message: {
                        role: 'assistant' as const,
                        content: '',
                        toolCalls: [{
                            id: 'tool-write-1',
                            name: 'write_file',
                            arguments: JSON.stringify({
                                path: fileName,
                                content,
                            }),
                        }],
                    },
                    usage: {
                        promptTokens: 1,
                        completionTokens: 1,
                        totalTokens: 2,
                    },
                    finishReason: 'tool_calls' as const,
                };
            }

            return {
                message: {
                    role: 'assistant' as const,
                    content: 'done',
                },
                usage: {
                    promptTokens: 1,
                    completionTokens: 1,
                    totalTokens: 2,
                },
                finishReason: 'stop' as const,
            };
        },
        stream: async () => {
            throw new Error('stream not implemented in test provider');
        },
    };
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('XQoderAgent permission behavior without approval callback', () => {
    it('allows tool execution when permission mode resolves to allow', async () => {
        const cwd = createTempDir();
        const target = path.join(cwd, 'allowed.txt');
        const agent = new XQoderAgent({
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                apiKey: 'test-key',
                maxTokens: 256,
                temperature: 0,
            },
            cwd,
            projectRoot: cwd,
            permissions: {
                defaultMode: 'deny',
                tools: { edit: 'allow' },
            },
        });

        (agent as unknown as { provider: ReturnType<typeof createToolCallProvider> }).provider = createToolCallProvider('allowed.txt', 'ok');

        await agent.run('write a file');

        expect(fs.existsSync(target)).toBe(true);
        expect(fs.readFileSync(target, 'utf-8')).toBe('ok');
        await agent.dispose();
    });

    it('denies ask-mode tools when no approval callback is provided', async () => {
        const cwd = createTempDir();
        const target = path.join(cwd, 'ask-mode.txt');
        const agent = new XQoderAgent({
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                apiKey: 'test-key',
                maxTokens: 256,
                temperature: 0,
            },
            cwd,
            projectRoot: cwd,
            permissions: {
                defaultMode: 'ask',
                tools: {},
            },
        });

        (agent as unknown as { provider: ReturnType<typeof createToolCallProvider> }).provider = createToolCallProvider('ask-mode.txt', 'nope');

        await agent.run('try write file');

        expect(fs.existsSync(target)).toBe(false);
        const toolResult = agent.getSession().getMessages().find((message) => message.role === 'tool');
        expect(toolResult?.content).toContain('审批被拒绝');
        await agent.dispose();
    });

    it('denies tools when permission mode resolves to deny', async () => {
        const cwd = createTempDir();
        const target = path.join(cwd, 'denied.txt');
        const agent = new XQoderAgent({
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                apiKey: 'test-key',
                maxTokens: 256,
                temperature: 0,
            },
            cwd,
            projectRoot: cwd,
            permissions: {
                defaultMode: 'deny',
                tools: {},
            },
        });

        (agent as unknown as { provider: ReturnType<typeof createToolCallProvider> }).provider = createToolCallProvider('denied.txt', 'nope');

        await agent.run('try write file');

        expect(fs.existsSync(target)).toBe(false);
        const toolResult = agent.getSession().getMessages().find((message) => message.role === 'tool');
        expect(toolResult?.content).toContain('permission: deny');
        await agent.dispose();
    });
});
