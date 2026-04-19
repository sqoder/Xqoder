import { describe, expect, it } from 'bun:test';
import type { ToolDefinition } from '@xqoder/shared';
import { logger as defaultLogger } from '@xqoder/shared';
import { executeAgentToolCalls, type AgentEventEmitter } from '../../src/core/agent/agent-tool-execution.js';
import { AgentSession } from '../../src/core/agent/session/session.js';
import { ToolRegistry, type ITool, type ToolApprovalRequest } from '../../src/core/agent/tools/tool.js';

describe('agent tool execution helper', () => {
    it('records denied approval results without executing the tool', async () => {
        const registry = new ToolRegistry();
        const session = new AgentSession({ id: 'session-agent-tool-execution' });
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;
        const emitted: string[] = [];

        registry.register({
            definition: {
                name: 'approval_split_test_tool',
                description: 'test tool requiring approval',
                parameters: [],
            } satisfies ToolDefinition,
            buildApprovalRequest: async () => ({
                toolCallId: 'call-approval-1',
                toolName: 'approval_split_test_tool',
                summary: 'Run approval split test tool',
                reason: 'Exercise agent-level approval handling',
                risk: 'medium',
            }),
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-approval-1',
                    success: true,
                    output: 'should not execute',
                };
            },
        } satisfies ITool);

        await executeAgentToolCalls(
            {
                toolRegistry: registry,
                session,
                toolContext: {
                    cwd: '/tmp/project',
                    projectRoot: '/tmp/project',
                },
                logger: defaultLogger.child('agent-tool-execution-test'),
                llmConfig: {
                    provider: 'openai',
                    model: 'test-model',
                    apiKey: 'test-key',
                },
                autoApproveTools: false,
                permissions: {
                    defaultMode: 'ask',
                    tools: {},
                },
                disableAllHooks: true,
                emit: ((type, data) => {
                    if (type === 'tool_response') {
                        emitted.push(`${data.name}:${data.success}`);
                    }
                }) as AgentEventEmitter,
            },
            [
                {
                    id: 'call-approval-1',
                    name: 'approval_split_test_tool',
                    arguments: '{"target":"file.txt"}',
                },
            ],
            {
                onToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
            'test-stream',
        );

        expect(executed).toBe(0);
        expect(approvalRequest?.summary).toBe('Run approval split test tool');
        expect(session.getToolHistory()).toMatchObject([
            {
                id: 'call-approval-1',
                name: 'approval_split_test_tool',
                success: false,
            },
        ]);
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: approval_split_test_tool');
        expect(emitted).toEqual(['approval_split_test_tool:false']);
    });
});
