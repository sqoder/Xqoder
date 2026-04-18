import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import { XQoderAgent, type AgentCallbacks, type AgentConfig } from '../../src/core/agent/agent.js';
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

describe('runtime tool hooks', () => {
    it('blocks tool execution when PreToolUse denies', async () => {
        const cwd = createTempDir();
        let executed = 0;
        const agent = createAgent(cwd, {
            PreToolUse: [
                {
                    matcher: 'hook_test_tool',
                    hooks: [
                        {
                            type: 'command',
                            command: createHookCommand({
                                hookSpecificOutput: {
                                    hookEventName: 'PreToolUse',
                                    permissionDecision: 'deny',
                                    permissionDecisionReason: 'blocked by hook',
                                },
                            }),
                        },
                    ],
                },
            ],
        });
        agent.registerTool(createTestTool('hook_test_tool', async () => {
            executed += 1;
            return {
                toolCallId: 'call-1',
                success: true,
                output: 'should not run',
            };
        }));

        await runToolCall(agent, {
            id: 'call-1',
            name: 'hook_test_tool',
            arguments: '{}',
        });

        expect(executed).toBe(0);
        const lastMessage = agent.getSession().getMessages().at(-1);
        expect(lastMessage?.role).toBe('tool');
        expect(lastMessage?.content).toContain('blocked by hook');
    });

    it('forces approval when PreToolUse returns ask', async () => {
        const cwd = createTempDir();
        let executed = 0;
        let approvals = 0;
        const agent = createAgent(cwd, {
            PreToolUse: [
                {
                    matcher: 'hook_test_tool',
                    hooks: [
                        {
                            type: 'command',
                            command: createHookCommand({
                                hookSpecificOutput: {
                                    hookEventName: 'PreToolUse',
                                    permissionDecision: 'ask',
                                    permissionDecisionReason: 'needs manual approval',
                                },
                            }),
                        },
                    ],
                },
            ],
        });
        agent.registerTool(createTestTool('hook_test_tool', async () => {
            executed += 1;
            return {
                toolCallId: 'call-2',
                success: true,
                output: 'should not run',
            };
        }));

        await runToolCall(agent, {
            id: 'call-2',
            name: 'hook_test_tool',
            arguments: '{"target":"tmp"}',
        }, {
            onToolApproval: async () => {
                approvals += 1;
                return false;
            },
        });

        expect(executed).toBe(0);
        expect(approvals).toBe(1);
        const lastMessage = agent.getSession().getMessages().at(-1);
        expect(lastMessage?.content).toContain('Tool approval denied');
    });

    it('appends PostToolUse feedback to the final tool output', async () => {
        const cwd = createTempDir();
        const agent = createAgent(cwd, {
            PostToolUse: [
                {
                    matcher: 'hook_test_tool',
                    hooks: [
                        {
                            type: 'command',
                            command: createHookCommand({
                                hookSpecificOutput: {
                                    hookEventName: 'PostToolUse',
                                    additionalContext: 'review the output before continuing',
                                },
                            }),
                        },
                    ],
                },
            ],
        });
        agent.registerTool(createTestTool('hook_test_tool', async () => ({
            toolCallId: 'call-3',
            success: true,
            output: 'tool ok',
        })));

        let toolEnd: { result: string; success: boolean } | undefined;
        await runToolCall(agent, {
            id: 'call-3',
            name: 'hook_test_tool',
            arguments: '{}',
        }, {
            onToolEnd: (name, result, success) => {
                if (name === 'hook_test_tool') {
                    toolEnd = { result, success };
                }
            },
        });

        expect(toolEnd?.success).toBe(true);
        expect(toolEnd?.result).toContain('tool ok');
        expect(toolEnd?.result).toContain('PostToolUse:');
        expect(toolEnd?.result).toContain('review the output before continuing');
    });
});

function createAgent(cwd: string, hooks: AgentConfig['hooks']): XQoderAgent {
    return new XQoderAgent({
        llmConfig: {
            provider: 'openai',
            model: 'test-model',
            apiKey: 'test-key',
        },
        cwd,
        projectRoot: cwd,
        permissions: {
            defaultMode: 'allow',
            tools: {},
        },
        hooks,
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

async function runToolCall(
    agent: XQoderAgent,
    toolCall: { id: string; name: string; arguments: string },
    callbacks?: Partial<AgentCallbacks>,
): Promise<void> {
    await (agent as any).executeToolCalls([toolCall], callbacks, 'test-stream');
}

function createHookCommand(response: Record<string, unknown>): string {
    const json = JSON.stringify(response);
    return `cat >/dev/null; printf '%s' '${json}'`;
}

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-hook-test-'));
    tempDirs.push(dir);
    return dir;
}
