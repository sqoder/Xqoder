import { describe, expect, it } from 'bun:test';
import type { ToolDefinition } from '@xqoder/shared';
import { logger as defaultLogger } from '@xqoder/shared';
import { executeAgentToolCalls, type AgentEventEmitter } from '../../src/core/agent/agent-tool-execution.js';
import { AgentSession } from '../../src/core/agent/session/session.js';
import { RunCommandTool, RunShellTool } from '../../src/core/agent/tools/command-tool.js';
import { DiagnosticsTool } from '../../src/core/agent/tools/diagnostics-tool.js';
import { GrepContentTool } from '../../src/core/agent/tools/discovery-tools.js';
import { ToolRegistry, type ITool, type ToolApprovalRequest } from '../../src/core/agent/tools/tool.js';

describe('agent tool execution helper', () => {
    it('records successful tool results and emits the tool_request -> tool_response chain', async () => {
        const registry = new ToolRegistry();
        const session = new AgentSession({ id: 'session-agent-tool-success' });
        const emitted: string[] = [];

        registry.register({
            definition: {
                name: 'echo_result_tool',
                description: 'echo tool result',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async (args) => ({
                toolCallId: 'call-success-1',
                success: true,
                output: `echo:${String(args.target ?? '')}`,
            }),
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
                autoApproveTools: true,
                permissions: {
                    defaultMode: 'allow',
                    tools: {},
                },
                disableAllHooks: true,
                emit: ((type, data) => {
                    if (type === 'tool_request') {
                        emitted.push(`request:${data.name}`);
                    }
                    if (type === 'tool_response') {
                        emitted.push(`response:${data.name}:${data.success}`);
                    }
                }) as AgentEventEmitter,
            },
            [
                {
                    id: 'call-success-1',
                    name: 'echo_result_tool',
                    arguments: '{"target":"file.txt"}',
                },
            ],
            undefined,
            'test-stream',
        );

        expect(session.getToolHistory()).toMatchObject([
            {
                id: 'call-success-1',
                name: 'echo_result_tool',
                success: true,
                args: {
                    target: 'file.txt',
                },
                outputPreview: 'echo:file.txt',
            },
        ]);
        expect(session.getMessages().at(-1)).toMatchObject({
            role: 'tool',
            toolCallId: 'call-success-1',
            content: 'echo:file.txt',
        });
        expect(emitted).toEqual([
            'request:echo_result_tool',
            'response:echo_result_tool:true',
        ]);
    });

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

    it('keeps failed tool_response output aligned with the stored tool message content', async () => {
        const registry = new ToolRegistry();
        const session = new AgentSession({ id: 'session-agent-tool-failure-parity' });
        const emittedOutputs: string[] = [];

        registry.register({
            definition: {
                name: 'failing_tool',
                description: 'always fails',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async () => ({
                toolCallId: 'call-failure-1',
                success: false,
                output: '',
                error: 'boom',
            }),
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
                autoApproveTools: true,
                permissions: {
                    defaultMode: 'allow',
                    tools: {},
                },
                disableAllHooks: true,
                emit: ((type, data) => {
                    if (type === 'tool_response') {
                        emittedOutputs.push(data.output);
                    }
                }) as AgentEventEmitter,
            },
            [{
                id: 'call-failure-1',
                name: 'failing_tool',
                arguments: '{}',
            }],
            undefined,
            'test-stream',
        );

        expect(session.getMessages().at(-1)?.content).toBe('Error: boom');
        expect(emittedOutputs).toEqual(['Error: boom']);
    });

    it('forces interactive approval before reading a path outside the project root', async () => {
        const registry = new ToolRegistry();
        const session = new AgentSession({ id: 'session-agent-tool-outside-project' });
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;

        registry.register({
            definition: {
                name: 'read_file',
                description: 'read a file',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async (args) => {
                executed += 1;
                return {
                    toolCallId: 'call-outside-read-1',
                    success: true,
                    output: `read:${String(args.path ?? '')}`,
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
                    sandboxMode: 'full-access',
                },
                logger: defaultLogger.child('agent-tool-execution-test'),
                llmConfig: {
                    provider: 'openai',
                    model: 'test-model',
                    apiKey: 'test-key',
                },
                autoApproveTools: false,
                permissions: {
                    defaultMode: 'allow',
                    tools: {},
                },
                disableAllHooks: true,
                emit: (() => {}) as AgentEventEmitter,
            },
            [
                {
                    id: 'call-outside-read-1',
                    name: 'read_file',
                    arguments: '{"path":"../Desktop/notes.txt"}',
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
        expect(approvalRequest).toMatchObject({
            toolName: 'read_file',
            summary: 'Request access to path outside project: ../Desktop/notes.txt',
            risk: 'high',
        });
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: read_file');
    });

    it('forces interactive approval before reading sensitive files inside the project', async () => {
        const registry = new ToolRegistry();
        const session = new AgentSession({ id: 'session-agent-tool-sensitive-read' });
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;

        registry.register({
            definition: {
                name: 'read_file',
                description: 'read a file',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async (args) => {
                executed += 1;
                return {
                    toolCallId: 'call-sensitive-read-1',
                    success: true,
                    output: `read:${String(args.path ?? '')}`,
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
                    sandboxMode: 'full-access',
                },
                logger: defaultLogger.child('agent-tool-execution-test'),
                llmConfig: {
                    provider: 'openai',
                    model: 'test-model',
                    apiKey: 'test-key',
                },
                autoApproveTools: false,
                permissions: {
                    defaultMode: 'allow',
                    tools: {},
                },
                disableAllHooks: true,
                emit: (() => {}) as AgentEventEmitter,
            },
            [
                {
                    id: 'call-sensitive-read-1',
                    name: 'read_file',
                    arguments: '{"path":".env.local"}',
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
        expect(approvalRequest).toMatchObject({
            toolName: 'read_file',
            summary: 'Request access to sensitive file: .env.local',
            risk: 'high',
        });
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: read_file');
    });

    it('forces interactive approval before outside-project discovery tools run', async () => {
        const cases = [
            {
                toolName: 'list_files',
                toolCallId: 'call-outside-list-1',
                arguments: '{"path":"../Desktop"}',
                summary: 'Request access to path outside project: ../Desktop',
            },
            {
                toolName: 'glob_files',
                toolCallId: 'call-outside-glob-1',
                arguments: '{"pattern":"*.md","path":"../Desktop"}',
                summary: 'Request access to path outside project: ../Desktop',
            },
            {
                toolName: 'search_code',
                toolCallId: 'call-outside-search-1',
                arguments: '{"pattern":"TODO","path":"../Desktop"}',
                summary: 'Request access to path outside project: ../Desktop',
            },
        ] as const;

        for (const testCase of cases) {
            const registry = new ToolRegistry();
            const session = new AgentSession({ id: `session-${testCase.toolName}` });
            let executed = 0;
            let approvalRequest: ToolApprovalRequest | undefined;

            registry.register({
                definition: {
                    name: testCase.toolName,
                    description: `${testCase.toolName} test stub`,
                    parameters: [],
                } satisfies ToolDefinition,
                execute: async () => {
                    executed += 1;
                    return {
                        toolCallId: testCase.toolCallId,
                        success: true,
                        output: `executed:${testCase.toolName}`,
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
                        sandboxMode: 'full-access',
                    },
                    logger: defaultLogger.child('agent-tool-execution-test'),
                    llmConfig: {
                        provider: 'openai',
                        model: 'test-model',
                        apiKey: 'test-key',
                    },
                    autoApproveTools: false,
                    permissions: {
                        defaultMode: 'allow',
                        tools: {},
                    },
                    disableAllHooks: true,
                    emit: (() => {}) as AgentEventEmitter,
                },
                [
                    {
                        id: testCase.toolCallId,
                        name: testCase.toolName,
                        arguments: testCase.arguments,
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
            expect(approvalRequest).toMatchObject({
                toolName: testCase.toolName,
                summary: testCase.summary,
                risk: 'high',
            });
            expect(session.getMessages().at(-1)?.content).toContain(`Tool approval denied: ${testCase.toolName}`);
        }
    });

    it('forces interactive approval before grep_content searches outside the project root', async () => {
        const registry = new ToolRegistry();
        const session = new AgentSession({ id: 'session-grep-outside-project' });
        let approvalRequest: ToolApprovalRequest | undefined;

        registry.register(new GrepContentTool());

        await executeAgentToolCalls(
            {
                toolRegistry: registry,
                session,
                toolContext: {
                    cwd: '/tmp/project',
                    projectRoot: '/tmp/project',
                    sandboxMode: 'full-access',
                },
                logger: defaultLogger.child('agent-tool-execution-test'),
                llmConfig: {
                    provider: 'openai',
                    model: 'test-model',
                    apiKey: 'test-key',
                },
                autoApproveTools: false,
                permissions: {
                    defaultMode: 'allow',
                    tools: {},
                },
                disableAllHooks: true,
                emit: (() => {}) as AgentEventEmitter,
            },
            [
                {
                    id: 'call-outside-grep-1',
                    name: 'grep_content',
                    arguments: '{"pattern":"TODO","path":"../Desktop"}',
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

        expect(approvalRequest).toMatchObject({
            toolName: 'grep_content',
            summary: 'Request access to path outside project: ../Desktop',
            risk: 'high',
        });
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: grep_content');
    });

    it('forces interactive approval before run_command uses an outside-project cwd', async () => {
        const registry = new ToolRegistry();
        const session = new AgentSession({ id: 'session-run-command-outside-project' });
        let approvalRequest: ToolApprovalRequest | undefined;

        registry.register(new RunCommandTool());

        await executeAgentToolCalls(
            {
                toolRegistry: registry,
                session,
                toolContext: {
                    cwd: '/tmp/project',
                    projectRoot: '/tmp/project',
                    sandboxMode: 'full-access',
                },
                logger: defaultLogger.child('agent-tool-execution-test'),
                llmConfig: {
                    provider: 'openai',
                    model: 'test-model',
                    apiKey: 'test-key',
                },
                autoApproveTools: false,
                permissions: {
                    defaultMode: 'allow',
                    tools: { bash: 'allow' },
                },
                disableAllHooks: true,
                emit: (() => {}) as AgentEventEmitter,
            },
            [
                {
                    id: 'call-outside-cwd-1',
                    name: 'run_command',
                    arguments: '{"command":"pwd","cwd":"../Desktop"}',
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

        expect(approvalRequest).toMatchObject({
            toolName: 'run_command',
            summary: 'Request access to path outside project: ../Desktop',
            risk: 'high',
        });
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: run_command');
    });

    it('forces interactive approval before run_shell uses an outside-project cwd', async () => {
        const registry = new ToolRegistry();
        const session = new AgentSession({ id: 'session-run-shell-outside-project' });
        let approvalRequest: ToolApprovalRequest | undefined;

        registry.register(new RunShellTool());

        await executeAgentToolCalls(
            {
                toolRegistry: registry,
                session,
                toolContext: {
                    cwd: '/tmp/project',
                    projectRoot: '/tmp/project',
                    sandboxMode: 'full-access',
                },
                logger: defaultLogger.child('agent-tool-execution-test'),
                llmConfig: {
                    provider: 'openai',
                    model: 'test-model',
                    apiKey: 'test-key',
                },
                autoApproveTools: false,
                permissions: {
                    defaultMode: 'allow',
                    tools: { bash: 'allow' },
                },
                disableAllHooks: true,
                emit: (() => {}) as AgentEventEmitter,
            },
            [
                {
                    id: 'call-outside-shell-cwd-1',
                    name: 'run_shell',
                    arguments: '{"command":"pwd","cwd":"../Desktop"}',
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

        expect(approvalRequest).toMatchObject({
            toolName: 'run_shell',
            summary: 'Request access to path outside project: ../Desktop',
            risk: 'high',
        });
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: run_shell');
    });

    it('forces interactive approval before file_path-based tools target outside-project files', async () => {
        const registry = new ToolRegistry();
        const session = new AgentSession({ id: 'session-diagnostics-outside-project' });
        let approvalRequest: ToolApprovalRequest | undefined;

        registry.register(new DiagnosticsTool());

        await executeAgentToolCalls(
            {
                toolRegistry: registry,
                session,
                toolContext: {
                    cwd: '/tmp/project',
                    projectRoot: '/tmp/project',
                    sandboxMode: 'full-access',
                },
                logger: defaultLogger.child('agent-tool-execution-test'),
                llmConfig: {
                    provider: 'openai',
                    model: 'test-model',
                    apiKey: 'test-key',
                },
                autoApproveTools: false,
                permissions: {
                    defaultMode: 'allow',
                    tools: {},
                },
                disableAllHooks: true,
                emit: (() => {}) as AgentEventEmitter,
            },
            [
                {
                    id: 'call-outside-diagnostics-1',
                    name: 'diagnostics',
                    arguments: '{"file_path":"../Desktop/notes.ts"}',
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

        expect(approvalRequest).toMatchObject({
            toolName: 'diagnostics',
            summary: 'Request access to path outside project: ../Desktop/notes.ts',
            risk: 'high',
        });
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: diagnostics');
    });

    it('turns ask-mode into a real approval gate even for tools without native approval requests', async () => {
        const registry = new ToolRegistry();
        const session = new AgentSession({ id: 'session-generic-ask-policy' });
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;

        registry.register({
            definition: {
                name: 'delegate_task',
                description: 'delegate a task',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-generic-ask-1',
                    success: true,
                    output: 'delegated',
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
                emit: (() => {}) as AgentEventEmitter,
            },
            [
                {
                    id: 'call-generic-ask-1',
                    name: 'delegate_task',
                    arguments: '{"task":"Inspect the routing layer"}',
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
        expect(approvalRequest).toMatchObject({
            toolName: 'delegate_task',
            summary: 'Permission policy requires approval before running delegate_task',
        });
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: delegate_task');
    });

    it('keeps MCP read-only tools available in plan capability', async () => {
        const registry = new ToolRegistry();
        const session = new AgentSession({ id: 'session-plan-mcp-readonly-tool' });
        let executed = 0;

        registry.register({
            definition: {
                name: 'mcp.docs.resources.list',
                description: 'list MCP resources',
                parameters: [],
            } satisfies ToolDefinition,
            getSecurityPolicyContext: () => ({
                source: 'mcp',
                trust: 'trusted',
                serverName: 'docs',
                operation: 'list_resources',
            }),
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-plan-mcp-read-1',
                    success: true,
                    output: 'Resource: README.md',
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
                    defaultMode: 'allow',
                    tools: { read: 'allow' },
                },
                executionCapability: 'plan',
                disableAllHooks: true,
                emit: (() => {}) as AgentEventEmitter,
            },
            [
                {
                    id: 'call-plan-mcp-read-1',
                    name: 'mcp.docs.resources.list',
                    arguments: '{}',
                },
            ],
            undefined,
            'test-stream',
        );

        expect(executed).toBe(1);
        expect(session.getMessages().at(-1)).toMatchObject({
            role: 'tool',
            toolCallId: 'call-plan-mcp-read-1',
            content: 'Resource: README.md',
        });
    });

    it('forces interactive approval for untrusted MCP reads even when auto-approve and read permissions are enabled', async () => {
        const registry = new ToolRegistry();
        const session = new AgentSession({ id: 'session-untrusted-mcp-read' });
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;

        registry.register({
            definition: {
                name: 'mcp.remote-docs.resources.read',
                description: 'read remote MCP resource',
                parameters: [],
            } satisfies ToolDefinition,
            getSecurityPolicyContext: () => ({
                source: 'mcp',
                trust: 'untrusted',
                serverName: 'remote-docs',
                operation: 'read_resource',
            }),
            buildApprovalRequest: () => ({
                toolCallId: '',
                toolName: 'mcp.remote-docs.resources.read',
                summary: 'Read MCP resource @ remote-docs',
                risk: 'low',
            }),
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-untrusted-mcp-read-1',
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
                autoApproveTools: true,
                permissions: {
                    defaultMode: 'allow',
                    tools: { read: 'allow' },
                },
                disableAllHooks: true,
                emit: (() => {}) as AgentEventEmitter,
            },
            [
                {
                    id: 'call-untrusted-mcp-read-1',
                    name: 'mcp.remote-docs.resources.read',
                    arguments: '{"uri":"file://README.md"}',
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
        expect(approvalRequest).toMatchObject({
            toolName: 'mcp.remote-docs.resources.read',
            summary: 'Read MCP resource @ remote-docs',
            risk: 'high',
        });
        expect(approvalRequest?.reason).toContain('untrusted MCP server');
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: mcp.remote-docs.resources.read');
    });

    it('blocks hidden write tools before approval policy evaluation in plan capability', async () => {
        const registry = new ToolRegistry();
        const session = new AgentSession({ id: 'session-plan-hidden-tool' });
        let executed = 0;

        registry.register({
            definition: {
                name: 'write_file',
                description: 'write a file',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-hidden-write-1',
                    success: true,
                    output: 'should not run',
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
                    defaultMode: 'allow',
                    tools: {},
                },
                executionCapability: 'plan',
                disableAllHooks: true,
                emit: (() => {}) as AgentEventEmitter,
            },
            [
                {
                    id: 'call-hidden-write-1',
                    name: 'write_file',
                    arguments: '{"path":"src/app.ts","content":"patched"}',
                },
            ],
            undefined,
            'test-stream',
        );

        expect(executed).toBe(0);
        expect(session.getToolHistory()).toMatchObject([
            {
                id: 'call-hidden-write-1',
                name: 'write_file',
                success: false,
            },
        ]);
        expect(session.getMessages().at(-1)?.content).toContain(
            'Tool "write_file" is not available in the current execution capability (plan)',
        );
    });
});
