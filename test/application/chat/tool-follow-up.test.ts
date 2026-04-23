import { describe, expect, it } from 'bun:test';
import { AgentSession } from '../../../src/core/agent/session/session.js';
import { handleToolFollowUp } from '../../../src/application/chat/tool-follow-up.js';

describe('tool follow-up', () => {
    it('executes tool calls and runs the verification bridge as one turn follow-up step', async () => {
        const session = new AgentSession({ id: 'tool-follow-up-verified', systemPrompt: 'system' });
        let verificationRuns = 0;

        const result = await handleToolFollowUp({
            toolCalls: [{
                id: 'tool-call-1',
                name: 'write_file',
                arguments: '{"path":"src/index.ts"}',
            }],
            streamId: 'stream-tool-follow-up',
            session,
            executeToolCalls: async (toolCalls) => {
                session.recordToolExecution({
                    id: toolCalls[0]!.id,
                    name: toolCalls[0]!.name,
                    args: { path: 'src/index.ts' },
                    success: true,
                    output: 'updated file',
                    startedAt: new Date(),
                    completedAt: new Date(),
                    metadata: {
                        path: 'src/index.ts',
                        changeType: 'write',
                        bytes: 12,
                        rollbackPointId: 'rollback_tool_follow_up',
                        timestamp: '2026-04-22T13:00:00.000Z',
                    },
                });
                session.addToolResult(toolCalls[0]!.id, 'updated file');
            },
            runtime: {
                async runPostToolVerification() {
                    verificationRuns += 1;
                    session.addMessage({
                        role: 'system',
                        content: 'Verification passed.',
                    });
                },
                getCompletionBlocker() {
                    return undefined;
                },
            },
        });

        expect(result).toEqual({
            handled: true,
            toolCallCount: 1,
            toolHistoryDelta: 1,
            executions: [{
                id: 'tool-call-1',
                name: 'write_file',
                args: {
                    path: 'src/index.ts',
                },
                ok: true,
                outputForModel: 'updated file',
                outputForUser: 'updated file',
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
                    id: 'tool-call-1',
                    name: 'write_file',
                    args: {
                        path: 'src/index.ts',
                    },
                    success: true,
                    outputPreview: 'updated file',
                    startedAt: expect.any(Date),
                    completedAt: expect.any(Date),
                },
                commandHistory: [],
                fileChanges: [{
                    id: 'tool-call-1',
                    path: 'src/index.ts',
                    changeType: 'write',
                    bytes: 12,
                    rollbackPointId: 'rollback_tool_follow_up',
                    success: true,
                    timestamp: expect.any(Date),
                }],
                modelMessages: [{
                    role: 'tool',
                    content: 'updated file',
                    toolCallId: 'tool-call-1',
                }],
                rendererEvents: [{
                    type: 'tool.output',
                    sessionId: 'tool-follow-up-verified',
                    toolCallId: 'tool-call-1',
                    toolName: 'write_file',
                    output: 'updated file',
                    timestamp: expect.any(Number),
                }, {
                    type: 'tool.completed',
                    sessionId: 'tool-follow-up-verified',
                    toolCallId: 'tool-call-1',
                    toolName: 'write_file',
                    success: true,
                    timestamp: expect.any(Number),
                }],
                transcriptEntries: [{
                    type: 'tool',
                    content: 'updated file',
                    toolCallId: 'tool-call-1',
                    toolName: 'write_file',
                    success: true,
                }],
                eventStoreRecords: [{
                    type: 'tool_result',
                    sessionId: 'tool-follow-up-verified',
                    toolCallId: 'tool-call-1',
                    toolName: 'write_file',
                    success: true,
                    content: 'updated file',
                    timestamp: expect.any(Number),
                }],
                checkpoint: {
                    required: true,
                    delegated: false,
                    status: 'captured',
                    rollbackPointId: 'rollback_tool_follow_up',
                },
            }],
            modelMessages: [{
                role: 'tool',
                content: 'updated file',
                toolCallId: 'tool-call-1',
            }],
            rendererEvents: [{
                type: 'tool.output',
                sessionId: 'tool-follow-up-verified',
                toolCallId: 'tool-call-1',
                toolName: 'write_file',
                output: 'updated file',
                timestamp: expect.any(Number),
            }, {
                type: 'tool.completed',
                sessionId: 'tool-follow-up-verified',
                toolCallId: 'tool-call-1',
                toolName: 'write_file',
                success: true,
                timestamp: expect.any(Number),
            }],
            transcriptEntries: [{
                type: 'tool',
                content: 'updated file',
                toolCallId: 'tool-call-1',
                toolName: 'write_file',
                success: true,
            }],
            eventStoreRecords: [{
                type: 'tool_result',
                sessionId: 'tool-follow-up-verified',
                toolCallId: 'tool-call-1',
                toolName: 'write_file',
                success: true,
                content: 'updated file',
                timestamp: expect.any(Number),
            }],
            verification: {
                invoked: true,
                triggered: true,
                blocked: false,
                runtimeInvoked: true,
                appendedMessages: [
                    {
                        role: 'system',
                        content: 'Verification passed.',
                    },
                ],
                signal: {
                    ok: true,
                    blocked: false,
                    summary: 'Verification passed.',
                    messages: ['Verification passed.'],
                },
            },
        });
        expect(verificationRuns).toBe(1);
        expect(session.getMessages().at(-1)).toEqual({
            role: 'system',
            content: 'Verification passed.',
        });
        expect(session.getVerificationHistory()).toEqual([{
            id: expect.any(String),
            ok: true,
            blocked: false,
            summary: 'Verification passed.',
            messages: ['Verification passed.'],
            createdAt: expect.any(Date),
        }]);
    });

    it('returns a noop result when no tool calls are present', async () => {
        const session = new AgentSession({ id: 'tool-follow-up-noop', systemPrompt: 'system' });
        let executeCalls = 0;

        const result = await handleToolFollowUp({
            toolCalls: [],
            streamId: 'stream-noop',
            session,
            executeToolCalls: async () => {
                executeCalls += 1;
            },
        });

        expect(result).toEqual({
            handled: false,
            toolCallCount: 0,
            toolHistoryDelta: 0,
            executions: [],
            modelMessages: [],
            rendererEvents: [],
            transcriptEntries: [],
            eventStoreRecords: [],
            verification: {
                invoked: false,
                triggered: false,
                blocked: false,
                appendedMessages: [],
            },
        });
        expect(executeCalls).toBe(0);
    });
});
