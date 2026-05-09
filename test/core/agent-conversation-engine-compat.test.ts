import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import type { CompletionRequest } from '@xqoder/llm-api';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import { buildWorkflowPrompt } from '../../src/application/workflows/prompt.js';
import { XQoderAgent } from '../../src/core/agent/agent.js';
import type { ITool, ToolContext } from '../../src/core/agent/tools/tool.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('XQoderAgent conversation-engine compatibility', () => {
    it('supports casual_chat turns through the conversation engine in mvp mode', async () => {
        const cwd = createTempDir();
        const requests: CompletionRequest[] = [];
        const agent = createAgent({
            cwd,
            runtimeProfile: 'mvp',
            providerFactory: async () => ({
                name: 'casual-provider',
                model: 'casual-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream(request) {
                    requests.push(request);
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: '你好，我在。',
                        },
                        usage: {
                            promptTokens: 9,
                            completionTokens: 4,
                            totalTokens: 13,
                        },
                    };
                },
            }),
        });

        const result = await agent.run('你好');

        expect(result).toBe('你好，我在。');
        expect(requests).toHaveLength(1);
        const plannerPrompt = findLatestSystemMessage(requests[0]!.messages);
        expect(plannerPrompt).toContain('Planner decision:');
        expect(plannerPrompt).toContain('- Task type: question');
        expect(plannerPrompt).toContain('- Preferred next action: answer');
    });

    it('exposes directory discovery tools in mvp mode before answering project-inspection requests', async () => {
        const cwd = createTempDir();
        const projectDir = path.join(cwd, 'personal-blog');
        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'package.json'), '{"name":"personal-blog"}\n', 'utf-8');
        const requests: CompletionRequest[] = [];
        const agent = createAgent({
            cwd,
            runtimeProfile: 'mvp',
            providerFactory: async () => ({
                name: 'directory-provider',
                model: 'directory-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream(request) {
                    requests.push(request);
                    if (requests.length === 1) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'list-project-dir',
                                    name: 'list_files',
                                    arguments: JSON.stringify({
                                        path: projectDir,
                                        maxDepth: 2,
                                    }),
                                }],
                            },
                            usage: {
                                promptTokens: 16,
                                completionTokens: 4,
                                totalTokens: 20,
                            },
                        };
                    }

                    if (requests.length === 2) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'read-project-package',
                                    name: 'read_file',
                                    arguments: JSON.stringify({
                                        path: path.join(projectDir, 'package.json'),
                                    }),
                                }],
                            },
                            usage: {
                                promptTokens: 20,
                                completionTokens: 5,
                                totalTokens: 25,
                            },
                        };
                    }

                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: '这是一个项目目录，我会先看目录结构。',
                        },
                        usage: {
                            promptTokens: 16,
                            completionTokens: 7,
                            totalTokens: 23,
                        },
                    };
                },
            }),
        });

        await agent.run(`${projectDir}看一下这个项目呢`);

        expect(requests).toHaveLength(3);
        const visibleTools = requests[0]!.tools?.map((tool) => tool.name) ?? [];
        const plannerPrompt = findLatestSystemMessage(requests[0]!.messages);
        expect(plannerPrompt).toContain(`${projectDir} (directory)`);
        expect(plannerPrompt).toContain('- Preferred next action: list_files');
        expect(visibleTools).toContain('read_file');
        expect(visibleTools).toContain('search_code');
        expect(visibleTools).toContain('list_files');
        expect(visibleTools).toContain('glob_files');
        expect(visibleTools).toContain('grep_content');
    });

    it('supports plan_only turns through the conversation engine in hybrid mode', async () => {
        const cwd = createTempDir();
        const requests: CompletionRequest[] = [];
        const agent = createAgent({
            cwd,
            agentName: 'plan',
            runtimeProfile: 'hybrid',
            providerFactory: async () => ({
                name: 'plan-provider',
                model: 'plan-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream(request) {
                    requests.push(request);
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: [
                                'WORKFLOW',
                                'Plan',
                                '',
                                'INPUT_SUMMARY',
                                'stabilize the command router',
                            ].join('\n'),
                        },
                        usage: {
                            promptTokens: 12,
                            completionTokens: 8,
                            totalTokens: 20,
                        },
                    };
                },
            }),
        });

        const result = await agent.run(buildWorkflowPrompt('plan', 'stabilize the command router'));

        expect(result).toContain('WORKFLOW');
        expect(requests).toHaveLength(1);
        const plannerPrompt = findLatestSystemMessage(requests[0]!.messages);
        const visibleTools = requests[0]!.tools?.map((tool) => tool.name) ?? [];
        expect(plannerPrompt).toContain('Mode: PLAN');
        expect(plannerPrompt).toContain('User request: stabilize the command router');
        expect(plannerPrompt).toContain('Planner decision:');
        expect(visibleTools).toContain('read_file');
        expect(visibleTools).toContain('search_code');
        expect(visibleTools).not.toContain('write_file');
        expect(visibleTools).not.toContain('apply_patch');
        expect(visibleTools).not.toContain('run_command');
        expect(visibleTools).not.toContain('install_package');
        expect(visibleTools).not.toContain('restore_rollback_point');
        expect(visibleTools).not.toContain('lsp_rename_symbol');
    });

    it('keeps engineering_edit turns on the legacy tool execution seam behind XQoderAgent.run()', async () => {
        const cwd = createTempDir();
        const requests: CompletionRequest[] = [];
        const toolExecutions: string[] = [];
        const toolEndEvents: Array<{ name: string; result: string; success: boolean }> = [];
        const agent = createAgent({
            cwd,
            runtimeProfile: 'hybrid',
            providerFactory: async () => ({
                name: 'engineering-provider',
                model: 'engineering-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream(request) {
                    requests.push(request);
                    if (requests.length === 1) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'legacy-edit-call-1',
                                    name: 'legacy_edit_tool',
                                    arguments: '{"path":"src/router.ts"}',
                                }],
                            },
                            usage: {
                                promptTokens: 15,
                                completionTokens: 3,
                                totalTokens: 18,
                            },
                        };
                    }

                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'patched src/router.ts',
                        },
                        usage: {
                            promptTokens: 16,
                            completionTokens: 4,
                            totalTokens: 20,
                        },
                    };
                },
            }),
        });
        agent.registerTool(createTestTool('legacy_edit_tool', async (args) => {
            toolExecutions.push(String(args.path ?? ''));
            return {
                toolCallId: 'legacy-edit-call-1',
                success: true,
                output: 'tool-result:patched src/router.ts',
            };
        }));

        const result = await agent.run('修复 src/router.ts 里的路由问题', {
            onToolEnd: (name, output, success) => {
                toolEndEvents.push({ name, result: output, success });
            },
        });

        expect(result).toBe('patched src/router.ts');
        expect(toolExecutions).toEqual(['src/router.ts']);
        expect(toolEndEvents).toEqual([{
            name: 'legacy_edit_tool',
            result: 'tool-result:patched src/router.ts',
            success: true,
        }]);
        expect(requests).toHaveLength(2);
        expect(requests[1]!.messages.some((message) =>
            message.role === 'tool' && String(message.content ?? '').includes('tool-result:patched src/router.ts'),
        )).toBe(true);
    });
});

function createAgent(input: {
    cwd: string;
    agentName?: string;
    runtimeProfile: 'mvp' | 'hybrid';
    providerFactory: ConstructorParameters<typeof XQoderAgent>[0]['providerFactory'];
}): XQoderAgent {
    return new XQoderAgent({
        llmConfig: {
            provider: 'openai',
            model: 'test-model',
            apiKey: 'test-key',
        },
        cwd: input.cwd,
        projectRoot: input.cwd,
        ...(input.agentName ? { agentName: input.agentName } : {}),
        runtimeProfile: input.runtimeProfile,
        permissions: {
            defaultMode: 'allow',
            tools: {},
        },
        providerFactory: input.providerFactory,
    });
}

function createTestTool(
    name: string,
    execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>,
): ITool {
    return {
        definition: {
            name,
            description: 'test tool',
            parameters: [],
        } satisfies ToolDefinition,
        execute,
    };
}

function findLatestSystemMessage(messages: CompletionRequest['messages']): string {
    const systemMessages = messages.filter((message) => message.role === 'system');
    return String(systemMessages.at(-1)?.content ?? '');
}

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-agent-conversation-engine-'));
    tempDirs.push(dir);
    return dir;
}
