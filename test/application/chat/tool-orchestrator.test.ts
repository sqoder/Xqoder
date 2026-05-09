import { describe, expect, it } from 'bun:test';
import { AgentSession } from '../../../src/core/agent/session/session.js';
import { runToolOrchestrator } from '../../../src/application/chat/tool-orchestrator.js';
import type { ToolExecutionPort } from '../../../src/domain/conversation/tool-execution-port.js';

describe('tool orchestrator', () => {
    it('collects tool_result output plus checkpoint and file-change deltas per call', async () => {
        const session = new AgentSession({ id: 'tool-orchestrator-file-change', systemPrompt: 'system' });
        const executeCalls: string[] = [];

        const result = await runToolOrchestrator({
            toolCalls: [{
                id: 'tool-call-write-1',
                name: 'write_file',
                arguments: '{"path":"src/index.ts"}',
            }],
            streamId: 'stream-tool-orchestrator',
            session,
            executeToolCalls: async (toolCalls) => {
                executeCalls.push(toolCalls[0]!.id);
                session.recordToolExecution({
                    id: toolCalls[0]!.id,
                    name: toolCalls[0]!.name,
                    args: { path: 'src/index.ts' },
                    success: true,
                    output: 'updated src/index.ts',
                    startedAt: new Date('2026-04-22T12:00:00.000Z'),
                    completedAt: new Date('2026-04-22T12:00:01.000Z'),
                    metadata: {
                        path: 'src/index.ts',
                        changeType: 'write',
                        bytes: 42,
                        rollbackPointId: 'rollback_123',
                        timestamp: '2026-04-22T12:00:01.000Z',
                    },
                });
                session.addToolResult(toolCalls[0]!.id, 'updated src/index.ts');
            },
        });

        expect(executeCalls).toEqual(['tool-call-write-1']);
        expect(result).toEqual({
            results: [{
                id: 'tool-call-write-1',
                name: 'write_file',
                args: {
                    path: 'src/index.ts',
                },
                ok: true,
                outputForModel: 'updated src/index.ts',
                outputForUser: 'updated src/index.ts',
                stages: [
                    {
                        stage: 'pre_tool_use',
                        detail: 'Prepared the tool call through the application-level compatibility port.',
                    },
                    {
                        stage: 'permission',
                        detail: 'Compatibility port will resolve permission and approval during execution.',
                    },
                    {
                        stage: 'checkpoint',
                        detail: 'Checkpoint required; rollback metadata will be collected from file-change artifacts after raw execution.',
                    },
                    {
                        stage: 'execute',
                        detail: 'Executed the prepared tool call through the raw invocation port.',
                    },
                    {
                        stage: 'collect',
                        detail: 'Collected 1 tool_result message(s), 0 command delta(s), and 1 file change delta(s).',
                    },
                    {
                        stage: 'post_tool_use',
                        detail: 'Applied post-tool finalization before projecting tool_result artifacts.',
                    },
                    {
                        stage: 'write_tool_result',
                        detail: 'Projected tool_result to model (1), renderer (2), transcript (1), and event-store (1) artifacts via session fallback synthesis.',
                    },
                    {
                        stage: 'emit_event',
                        detail: 'Prepared 2 renderer event artifact(s) for envelope-aware surfaces.',
                    },
                ],
                toolHistoryEntry: {
                    id: 'tool-call-write-1',
                    name: 'write_file',
                    args: {
                        path: 'src/index.ts',
                    },
                    success: true,
                    outputPreview: 'updated src/index.ts',
                    startedAt: new Date('2026-04-22T12:00:00.000Z'),
                    completedAt: new Date('2026-04-22T12:00:01.000Z'),
                },
                commandHistory: [],
                fileChanges: [{
                    id: expect.any(String),
                    path: 'src/index.ts',
                    changeType: 'write',
                    bytes: 42,
                    rollbackPointId: 'rollback_123',
                    success: true,
                    timestamp: new Date('2026-04-22T12:00:01.000Z'),
                }],
                modelMessages: [{
                    role: 'tool',
                    content: 'updated src/index.ts',
                    toolCallId: 'tool-call-write-1',
                }],
                rendererEvents: [{
                    type: 'tool.output',
                    sessionId: 'tool-orchestrator-file-change',
                    toolCallId: 'tool-call-write-1',
                    toolName: 'write_file',
                    output: 'updated src/index.ts',
                    timestamp: new Date('2026-04-22T12:00:01.000Z').getTime(),
                }, {
                    type: 'tool.completed',
                    sessionId: 'tool-orchestrator-file-change',
                    toolCallId: 'tool-call-write-1',
                    toolName: 'write_file',
                    success: true,
                    timestamp: new Date('2026-04-22T12:00:01.000Z').getTime() + 1,
                }],
                transcriptEntries: [{
                    type: 'tool',
                    content: 'updated src/index.ts',
                    toolCallId: 'tool-call-write-1',
                    toolName: 'write_file',
                    success: true,
                }],
                eventStoreRecords: [{
                    type: 'tool_result',
                    sessionId: 'tool-orchestrator-file-change',
                    toolCallId: 'tool-call-write-1',
                    toolName: 'write_file',
                    success: true,
                    content: 'updated src/index.ts',
                    timestamp: new Date('2026-04-22T12:00:01.000Z').getTime(),
                }],
                checkpoint: {
                    required: true,
                    delegated: false,
                    status: 'captured',
                    rollbackPointId: 'rollback_123',
                },
            }],
            toolHistoryDelta: 1,
            modelMessages: [{
                role: 'tool',
                content: 'updated src/index.ts',
                toolCallId: 'tool-call-write-1',
            }],
            rendererEvents: [{
                type: 'tool.output',
                sessionId: 'tool-orchestrator-file-change',
                toolCallId: 'tool-call-write-1',
                toolName: 'write_file',
                output: 'updated src/index.ts',
                timestamp: new Date('2026-04-22T12:00:01.000Z').getTime(),
            }, {
                type: 'tool.completed',
                sessionId: 'tool-orchestrator-file-change',
                toolCallId: 'tool-call-write-1',
                toolName: 'write_file',
                success: true,
                timestamp: new Date('2026-04-22T12:00:01.000Z').getTime() + 1,
            }],
            transcriptEntries: [{
                type: 'tool',
                content: 'updated src/index.ts',
                toolCallId: 'tool-call-write-1',
                toolName: 'write_file',
                success: true,
            }],
            eventStoreRecords: [{
                type: 'tool_result',
                sessionId: 'tool-orchestrator-file-change',
                toolCallId: 'tool-call-write-1',
                toolName: 'write_file',
                success: true,
                content: 'updated src/index.ts',
                timestamp: new Date('2026-04-22T12:00:01.000Z').getTime(),
            }],
        });
    });

    it('runs tool calls one-by-one so each result can be collected independently', async () => {
        const session = new AgentSession({ id: 'tool-orchestrator-sequential', systemPrompt: 'system' });
        const executeBatches: string[][] = [];

        const result = await runToolOrchestrator({
            toolCalls: [{
                id: 'tool-call-1',
                name: 'read_file',
                arguments: '{"path":"README.md"}',
            }, {
                id: 'tool-call-2',
                name: 'read_file',
                arguments: '{"path":"package.json"}',
            }],
            streamId: 'stream-tool-orchestrator-sequential',
            session,
            executeToolCalls: async (toolCalls) => {
                executeBatches.push(toolCalls.map((toolCall) => toolCall.id));
                const toolCall = toolCalls[0]!;
                const path = toolCall.id === 'tool-call-1' ? 'README.md' : 'package.json';
                session.recordToolExecution({
                    id: toolCall.id,
                    name: toolCall.name,
                    args: { path },
                    success: true,
                    output: `contents:${path}`,
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(toolCall.id, `contents:${path}`);
            },
        });

        expect(executeBatches).toEqual([
            ['tool-call-1'],
            ['tool-call-2'],
        ]);
        expect(result.results.map((entry) => entry.outputForModel)).toEqual([
            'contents:README.md',
            'contents:package.json',
        ]);
        expect(result.results.map((entry) => entry.stages.map((stage) => stage.stage))).toEqual([
            ['pre_tool_use', 'permission', 'checkpoint', 'execute', 'collect', 'post_tool_use', 'write_tool_result', 'emit_event'],
            ['pre_tool_use', 'permission', 'checkpoint', 'execute', 'collect', 'post_tool_use', 'write_tool_result', 'emit_event'],
        ]);
        expect(result.rendererEvents).toEqual([
            {
                type: 'tool.output',
                sessionId: 'tool-orchestrator-sequential',
                toolCallId: 'tool-call-1',
                toolName: 'read_file',
                output: 'contents:README.md',
                timestamp: expect.any(Number),
            },
            {
                type: 'tool.completed',
                sessionId: 'tool-orchestrator-sequential',
                toolCallId: 'tool-call-1',
                toolName: 'read_file',
                success: true,
                timestamp: expect.any(Number),
            },
            {
                type: 'tool.output',
                sessionId: 'tool-orchestrator-sequential',
                toolCallId: 'tool-call-2',
                toolName: 'read_file',
                output: 'contents:package.json',
                timestamp: expect.any(Number),
            },
            {
                type: 'tool.completed',
                sessionId: 'tool-orchestrator-sequential',
                toolCallId: 'tool-call-2',
                toolName: 'read_file',
                success: true,
                timestamp: expect.any(Number),
            },
        ]);
        expect(result.transcriptEntries).toEqual([
            {
                type: 'tool',
                content: 'contents:README.md',
                toolCallId: 'tool-call-1',
                toolName: 'read_file',
                success: true,
            },
            {
                type: 'tool',
                content: 'contents:package.json',
                toolCallId: 'tool-call-2',
                toolName: 'read_file',
                success: true,
            },
        ]);
        expect(result.toolHistoryDelta).toBe(2);
    });

    it('invokes allowed read-only concurrency-safe prepared tool calls in parallel and finalizes them in order', async () => {
        const session = new AgentSession({ id: 'tool-orchestrator-parallel-read', systemPrompt: 'system' });
        const prepareOrder: string[] = [];
        const invokeOrder: string[] = [];
        const finalizeOrder: string[] = [];
        let activeInvocations = 0;
        let maxActiveInvocations = 0;

        const port: ToolExecutionPort = {
            async prepareToolCall(input) {
                prepareOrder.push(input.toolCall.id);
                return {
                    toolCall: input.toolCall,
                    args: JSON.parse(input.toolCall.arguments),
                    callbacks: input.callbacks,
                    streamId: input.streamId,
                    permissionMode: 'allow',
                    blocked: false,
                    canRunInParallel: true,
                    preToolUseDetail: 'prepared read-only call',
                    permissionDetail: 'allowed read-only call',
                    state: undefined,
                };
            },
            async invokePreparedToolCall(preparation) {
                activeInvocations += 1;
                maxActiveInvocations = Math.max(maxActiveInvocations, activeInvocations);
                invokeOrder.push(preparation.toolCall.id);
                await new Promise((resolve) => setTimeout(resolve, 10));
                activeInvocations -= 1;
                return {
                    toolCallId: preparation.toolCall.id,
                    success: true,
                    output: `contents:${String(preparation.args['path'])}`,
                };
            },
            async finalizeToolCall(preparation, result) {
                finalizeOrder.push(preparation.toolCall.id);
                session.recordToolExecution({
                    id: preparation.toolCall.id,
                    name: preparation.toolCall.name,
                    args: preparation.args,
                    success: result?.success ?? false,
                    output: result?.output ?? '',
                    error: result?.error,
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(preparation.toolCall.id, result?.output ?? '');
                return result!;
            },
        };

        const result = await runToolOrchestrator({
            toolCalls: [{
                id: 'parallel-read-1',
                name: 'read_file',
                arguments: '{"path":"README.md"}',
            }, {
                id: 'parallel-read-2',
                name: 'read_file',
                arguments: '{"path":"package.json"}',
            }],
            streamId: 'stream-tool-orchestrator-parallel-read',
            session,
            toolExecutionPort: port,
            executeToolCalls: async () => [],
        });

        expect(prepareOrder).toEqual(['parallel-read-1', 'parallel-read-2']);
        expect(invokeOrder).toEqual(['parallel-read-1', 'parallel-read-2']);
        expect(maxActiveInvocations).toBe(2);
        expect(finalizeOrder).toEqual(['parallel-read-1', 'parallel-read-2']);
        expect(result.results.map((entry) => entry.outputForModel)).toEqual([
            'contents:README.md',
            'contents:package.json',
        ]);
    });

    it('proxies live tool renderer callbacks so user-visible tool output is mediated by the orchestrator', async () => {
        const session = new AgentSession({ id: 'tool-orchestrator-live-renderer', systemPrompt: 'system' });
        const callbackLog: string[] = [];

        const result = await runToolOrchestrator({
            toolCalls: [{
                id: 'tool-call-command-1',
                name: 'run_command',
                arguments: '{"command":"printf hi"}',
            }],
            callbacks: {
                onToolStart: (name, args) => {
                    callbackLog.push(`start:${name}:${String(args.command ?? '')}`);
                },
                onToolStream: (name, chunk, stream) => {
                    callbackLog.push(`stream:${name}:${stream}:${chunk}`);
                },
                onToolEnd: (name, output, success) => {
                    callbackLog.push(`end:${name}:${success}:${output}`);
                },
            },
            streamId: 'stream-tool-orchestrator-live-renderer',
            session,
            executeToolCalls: async (toolCalls, callbacks) => {
                callbacks?.onToolStart?.(toolCalls[0]!.name, { command: 'printf hi' });
                callbacks?.onToolStream?.(toolCalls[0]!.name, 'hi', 'stdout');
                session.recordToolExecution({
                    id: toolCalls[0]!.id,
                    name: toolCalls[0]!.name,
                    args: { command: 'printf hi' },
                    success: true,
                    output: 'hi',
                    startedAt: new Date('2026-04-22T12:30:00.000Z'),
                    completedAt: new Date('2026-04-22T12:30:01.000Z'),
                    metadata: {
                        command: 'printf hi',
                        cwd: '/tmp/project',
                    },
                });
                session.addToolResult(toolCalls[0]!.id, 'hi');
                callbacks?.onToolEnd?.(toolCalls[0]!.name, 'hi', true);
            },
        });

        expect(callbackLog).toEqual([
            'start:run_command:printf hi',
            'stream:run_command:stdout:hi',
            'end:run_command:true:hi',
        ]);
        expect(result.results[0]?.rendererEvents).toEqual([
            {
                type: 'tool.output',
                sessionId: 'tool-orchestrator-live-renderer',
                toolCallId: 'tool-call-command-1',
                toolName: 'run_command',
                output: 'hi',
                partial: true,
                stream: 'stdout',
                timestamp: expect.any(Number),
            },
            {
                type: 'tool.output',
                sessionId: 'tool-orchestrator-live-renderer',
                toolCallId: 'tool-call-command-1',
                toolName: 'run_command',
                output: 'hi',
                timestamp: expect.any(Number),
            },
            {
                type: 'tool.completed',
                sessionId: 'tool-orchestrator-live-renderer',
                toolCallId: 'tool-call-command-1',
                toolName: 'run_command',
                success: true,
                timestamp: expect.any(Number),
            },
        ]);
        expect(result.results[0]?.stages).toContainEqual({
            stage: 'write_tool_result',
            detail: 'Projected tool_result to model (1), renderer (3), transcript (1), and event-store (1) artifacts via the ToolOrchestrator callback proxy.',
        });
        expect(result.results[0]?.checkpoint).toEqual({
            required: false,
            delegated: false,
            status: 'not_required',
        });
        expect(result.results[0]?.commandHistory).toEqual([{
            id: 'tool-call-command-1',
            command: 'printf hi',
            cwd: '/tmp/project',
            success: true,
            outputPreview: 'hi',
            startedAt: new Date('2026-04-22T12:30:00.000Z'),
            completedAt: new Date('2026-04-22T12:30:01.000Z'),
        }]);
    });

    it('synthesizes tool_result model output and replays fallback renderer callbacks when the executor only records tool history', async () => {
        const session = new AgentSession({ id: 'tool-orchestrator-fallback', systemPrompt: 'system' });
        const callbackLog: string[] = [];

        const result = await runToolOrchestrator({
            toolCalls: [{
                id: 'tool-call-fallback-1',
                name: 'write_file',
                arguments: '{"path":"src/generated.ts"}',
            }],
            callbacks: {
                onToolStart: (name, args) => {
                    callbackLog.push(`start:${name}:${String(args.path ?? '')}`);
                },
                onToolEnd: (name, output, success) => {
                    callbackLog.push(`end:${name}:${output}:${success ? 'ok' : 'fail'}`);
                },
            },
            streamId: 'stream-tool-orchestrator-fallback',
            session,
            executeToolCalls: async (toolCalls) => {
                session.recordToolExecution({
                    id: toolCalls[0]!.id,
                    name: toolCalls[0]!.name,
                    args: { path: 'src/generated.ts' },
                    success: true,
                    output: 'generated file content',
                    startedAt: new Date('2026-04-22T13:30:00.000Z'),
                    completedAt: new Date('2026-04-22T13:30:01.000Z'),
                    metadata: {
                        path: 'src/generated.ts',
                        changeType: 'write',
                        bytes: 22,
                        rollbackPointId: 'rollback_generated',
                        timestamp: '2026-04-22T13:30:01.000Z',
                    },
                });
            },
        });

        expect(callbackLog).toEqual([
            'start:write_file:src/generated.ts',
            'end:write_file:generated file content:ok',
        ]);
        expect(session.getMessages().at(-1)).toEqual({
            role: 'tool',
            content: 'generated file content',
            toolCallId: 'tool-call-fallback-1',
        });
        expect(result.modelMessages).toEqual([{
            role: 'tool',
            content: 'generated file content',
            toolCallId: 'tool-call-fallback-1',
        }]);
        expect(result.results[0]?.stages).toContainEqual({
            stage: 'write_tool_result',
            detail: 'Projected tool_result to model (1), renderer (2), transcript (1), and event-store (1) artifacts via session fallback synthesis.',
        });
        expect(result.rendererEvents).toEqual([{
            type: 'tool.output',
            sessionId: 'tool-orchestrator-fallback',
            toolCallId: 'tool-call-fallback-1',
            toolName: 'write_file',
            output: 'generated file content',
            timestamp: new Date('2026-04-22T13:30:01.000Z').getTime(),
        }, {
            type: 'tool.completed',
            sessionId: 'tool-orchestrator-fallback',
            toolCallId: 'tool-call-fallback-1',
            toolName: 'write_file',
            success: true,
            timestamp: new Date('2026-04-22T13:30:01.000Z').getTime() + 1,
        }]);
        expect(result.transcriptEntries).toEqual([{
            type: 'tool',
            content: 'generated file content',
            toolCallId: 'tool-call-fallback-1',
            toolName: 'write_file',
            success: true,
        }]);
    });

    it('uses an injected toolExecutionPort instead of falling back to the compatibility executor', async () => {
        const session = new AgentSession({ id: 'tool-orchestrator-custom-port', systemPrompt: 'system' });
        const calls = {
            prepare: 0,
            invoke: 0,
            finalize: 0,
            compatibility: 0,
        };

        const result = await runToolOrchestrator({
            toolCalls: [{
                id: 'tool-call-custom-port-1',
                name: 'read_file',
                arguments: '{"path":"README.md"}',
            }],
            streamId: 'stream-tool-orchestrator-custom-port',
            session,
            toolExecutionPort: {
                async prepareToolCall(input) {
                    calls.prepare += 1;
                    return {
                        toolCall: input.toolCall,
                        args: { path: 'README.md' },
                        callbacks: input.callbacks,
                        streamId: input.streamId,
                        permissionMode: 'allow',
                        blocked: false,
                        preToolUseDetail: 'Custom port prepared the tool call.',
                        permissionDetail: 'Custom port resolved permissions before raw execution.',
                        state: undefined,
                    };
                },
                async invokePreparedToolCall(preparation) {
                    calls.invoke += 1;
                    session.recordToolExecution({
                        id: preparation.toolCall.id,
                        name: preparation.toolCall.name,
                        args: { path: 'README.md' },
                        success: true,
                        output: 'custom-port:README.md',
                        startedAt: new Date('2026-04-23T12:00:00.000Z'),
                        completedAt: new Date('2026-04-23T12:00:01.000Z'),
                    });
                    return {
                        toolCallId: preparation.toolCall.id,
                        success: true,
                        output: 'custom-port:README.md',
                    };
                },
                async finalizeToolCall(preparation, toolResult) {
                    calls.finalize += 1;
                    session.addToolResult(preparation.toolCall.id, toolResult?.output ?? '');
                    return toolResult ?? {
                        toolCallId: preparation.toolCall.id,
                        success: false,
                        output: '',
                        error: 'missing',
                    };
                },
            },
            executeToolCalls: async () => {
                calls.compatibility += 1;
                return [];
            },
        });

        expect(calls).toEqual({
            prepare: 1,
            invoke: 1,
            finalize: 1,
            compatibility: 0,
        });
        expect(result.results[0]?.stages).toContainEqual({
            stage: 'pre_tool_use',
            detail: 'Custom port prepared the tool call.',
        });
        expect(result.results[0]?.outputForModel).toBe('custom-port:README.md');
    });
});
