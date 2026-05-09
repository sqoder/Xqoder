import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { CompletionRequest, CompletionResponse, ILLMProvider } from '../../src/shared/llm-api/base.js';
import type { ToolDefinition, LLMProviderConfig, StreamCallbacks } from '@xqoder/shared';
import { DelegateTaskTool } from '../../src/core/agent/tools/agent-tool.js';
import {
    ToolRegistry,
    type ITool,
    type ToolApprovalRequest,
    type ToolSecurityPolicyContext,
} from '../../src/core/agent/tools/tool.js';

describe('DelegateTaskTool', () => {
    it('defaults to the explore subagent and keeps delegated tools read-only', async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-delegate-explore-'));
        try {
            // Provide a hermetic project-level explore subagent so the test
            // does not depend on whatever the developer (or CI runner) has
            // in `~/.claude/agents/explore.md`. Project-level agents win the
            // dedup in `listMarkdownAgents`.
            fs.mkdirSync(path.join(cwd, '.claude', 'agents'), { recursive: true });
            fs.writeFileSync(
                path.join(cwd, '.claude', 'agents', 'explore.md'),
                [
                    '---',
                    'name: explore',
                    'tools:',
                    '  - read_file',
                    '  - grep_content',
                    '---',
                    'You are Explorer. Read-only exploration of the codebase.',
                ].join('\n'),
                'utf-8',
            );

            const registry = createRegistryWithWritableAndReadonlyTools();
            const requests: CompletionRequest[] = [];
            const tool = new DelegateTaskTool(createLlmConfig(), registry, async () => createProvider(requests));

            const result = await tool.execute({
                task: 'Find the session store implementation',
                toolCallId: 'delegate-explore-1',
            }, {
                cwd,
                projectRoot: cwd,
            });

            expect(result.success).toBe(true);
            expect(result.output).toContain('agent: explore');
            expect(requests[0]?.messages[0]?.content).toContain('You are Explorer');
            expect(requests[0]?.messages[0]?.content).toContain('Read-only');
            expect(requests[0]?.tools?.map((entry) => entry.name).sort()).toEqual([
                'grep_content',
                'read_file',
            ]);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('can route to the built-in plan subagent without exposing write or bash tools', async () => {
        const registry = createRegistryWithWritableAndReadonlyTools();
        const requests: CompletionRequest[] = [];
        const tool = new DelegateTaskTool(createLlmConfig(), registry, async () => createProvider(requests));

        const result = await tool.execute({
            task: 'Plan the approval persistence refactor',
            agent: 'plan',
            mode: 'plan',
            toolCallId: 'delegate-plan-1',
        }, {
            cwd: '/workspace/project',
            projectRoot: '/workspace/project',
        });

        expect(result.success).toBe(true);
        expect(result.output).toContain('agent: plan');
        expect(requests[0]?.messages[0]?.content).toContain('task planning agent');
        expect(requests[0]?.tools?.some((entry) => entry.name === 'write_file')).toBe(false);
        expect(requests[0]?.tools?.some((entry) => entry.name === 'run_shell')).toBe(false);
    });

    it('executes delegated tool calls through the registry so approval policy still applies', async () => {
        const registry = new ToolRegistry();
        const approvals: ToolApprovalRequest[] = [];
        registry.register(createTool('read_file', {
            approvalSummary: 'Read sensitive file',
            output: 'safe read output',
        }));
        const requests: CompletionRequest[] = [];
        const tool = new DelegateTaskTool(
            createLlmConfig(),
            registry,
            async () => createProvider(requests, [
                {
                    message: {
                        role: 'assistant',
                        content: '',
                        toolCalls: [{
                            id: 'sub-read-1',
                            name: 'read_file',
                            arguments: JSON.stringify({ path: '.env' }),
                        }],
                    },
                    usage: {
                        promptTokens: 1,
                        completionTokens: 1,
                        totalTokens: 2,
                    },
                    finishReason: 'tool_calls',
                },
                {
                    message: {
                        role: 'assistant',
                        content: 'delegated final answer',
                    },
                    usage: {
                        promptTokens: 1,
                        completionTokens: 1,
                        totalTokens: 2,
                    },
                    finishReason: 'stop',
                },
            ]),
        );

        const result = await tool.execute({
            task: 'Read a file through the delegated registry path',
            toolCallId: 'delegate-approval-1',
        }, {
            cwd: '/workspace/project',
            projectRoot: '/workspace/project',
            requestToolApproval: async (request) => {
                approvals.push(request);
                return true;
            },
        });

        expect(result.success).toBe(true);
        expect(result.output).toContain('safe read output');
        expect(approvals).toHaveLength(1);
        expect(approvals[0]).toMatchObject({
            toolName: 'read_file',
            toolCallId: 'sub-read-1',
            summary: 'Read sensitive file',
        });
    });

    it('filters custom markdown subagent tools through read-only capability checks', async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-delegate-agent-'));
        try {
            fs.mkdirSync(path.join(cwd, '.claude', 'agents'), { recursive: true });
            fs.writeFileSync(
                path.join(cwd, '.claude', 'agents', 'deploy.md'),
                [
                    '---',
                    'name: deploy',
                    'tools:',
                    '  - deploy_preview',
                    '  - repo_resource_read',
                    '  - run_shell',
                    '---',
                    'Inspect deployment state without making changes.',
                ].join('\n'),
                'utf-8',
            );
            const registry = new ToolRegistry();
            registry.register(createTool('deploy_preview', {
                securityContext: {
                    source: 'mcp',
                    serverName: 'deploy',
                    trust: 'trusted',
                    operation: 'tool_call',
                },
            }));
            registry.register(createTool('repo_resource_read', {
                securityContext: {
                    source: 'mcp',
                    serverName: 'repo',
                    trust: 'trusted',
                    operation: 'read_resource',
                },
            }));
            registry.register(createTool('run_shell'));
            const requests: CompletionRequest[] = [];
            const tool = new DelegateTaskTool(createLlmConfig(), registry, async () => createProvider(requests));

            const result = await tool.execute({
                task: 'Inspect deployment state',
                agent: 'deploy',
                toolCallId: 'delegate-markdown-1',
            }, {
                cwd,
                projectRoot: cwd,
            });

            expect(result.success).toBe(true);
            expect(requests[0]?.tools?.map((entry) => entry.name)).toEqual(['repo_resource_read']);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });
});

function createRegistryWithWritableAndReadonlyTools(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register(createTool('read_file'));
    registry.register(createTool('grep_content'));
    registry.register(createTool('write_file'));
    registry.register(createTool('run_shell'));
    return registry;
}

function createTool(
    name: string,
    options: {
        output?: string;
        approvalSummary?: string;
        securityContext?: ToolSecurityPolicyContext;
    } = {},
): ITool {
    const tool: ITool = {
        definition: {
            name,
            description: `${name} test tool`,
            parameters: [],
        } satisfies ToolDefinition,
        execute: async () => ({
            toolCallId: `${name}-call`,
            success: true,
            output: options.output ?? `${name} output`,
        }),
    };
    const securityContext = options.securityContext;
    if (securityContext) {
        tool.getSecurityPolicyContext = () => securityContext;
    }
    const approvalSummary = options.approvalSummary;
    if (approvalSummary) {
        tool.buildApprovalRequest = () => ({
            toolCallId: '',
            toolName: name,
            summary: approvalSummary,
            reason: 'test approval',
            risk: 'medium',
        });
    }
    return tool;
}

function createProvider(
    requests: CompletionRequest[],
    responses: CompletionResponse[] = [{
        message: {
            role: 'assistant',
            content: 'delegated answer',
        },
        usage: {
            promptTokens: 1,
            completionTokens: 1,
            totalTokens: 2,
        },
        finishReason: 'stop',
    }],
): ILLMProvider {
    let responseIndex = 0;
    const nextResponse = (): CompletionResponse => responses[Math.min(responseIndex++, responses.length - 1)]!;
    return {
        name: 'fake',
        model: 'fake-model',
        complete: async (request): Promise<CompletionResponse> => {
            requests.push(request);
            return nextResponse();
        },
        stream: async (request: CompletionRequest, _callbacks: StreamCallbacks): Promise<CompletionResponse> => {
            requests.push(request);
            return nextResponse();
        },
    };
}

function createLlmConfig(): LLMProviderConfig {
    return {
        provider: 'openai',
        model: 'fake-model',
        apiKey: 'fake-key',
    };
}
