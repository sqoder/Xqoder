import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { createConversationEventEnvelopeEmitter } from '@xqoder/protocol';
import { AgentSession } from '../../src/core/agent/session/session.js';
import { SQLiteSessionStore } from '../../src/core/agent/session/store.js';
import { buildProjectedConversationTranscript } from '../../src/domain/conversation/transcript-projector.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('SQLiteSessionStore usage persistence', () => {
    it('persists usage cost, cache token fields, verification history, and tool-result projections across a fresh reload', () => {
        const tempDir = createTempDir();
        const dbPath = path.join(tempDir, 'sessions.db');
        const projectRoot = path.join(tempDir, 'project');
        fs.mkdirSync(projectRoot, { recursive: true });

        const session = new AgentSession({
            id: 'session-store-usage',
            systemPrompt: 'system',
        });
        const eventEmitter = createConversationEventEnvelopeEmitter(
            'session-store-usage',
            'session-store-usage:turn:persisted',
        );
        session.addUserMessage('persist usage');
        session.recordCheckpoint({
            toolCallId: 'tool-usage-1',
            toolName: 'write_file',
            required: true,
            status: 'captured',
            rollbackPointId: 'rollback_usage_1',
            timestamp: new Date('2026-04-22T16:00:00.000Z'),
        });
        session.recordUsage({
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        });
        session.addMessage({
            role: 'system',
            content: 'Verification passed: persisted across reload',
        });
        session.recordVerification({
            ok: true,
            blocked: false,
            summary: 'Verification passed: persisted across reload',
            messages: ['Verification passed: persisted across reload'],
        });
        session.recordToolResultArtifacts({
            rendererEvents: [{
                type: 'tool.output',
                sessionId: 'session-store-usage',
                toolCallId: 'tool-usage-1',
                toolName: 'write_file',
                output: 'persisted tool output',
                timestamp: 1713513901000,
            }, {
                type: 'tool.completed',
                sessionId: 'session-store-usage',
                toolCallId: 'tool-usage-1',
                toolName: 'write_file',
                success: true,
                timestamp: 1713513901001,
            }],
            transcriptEntries: [{
                type: 'tool',
                content: 'persisted tool output',
                toolCallId: 'tool-usage-1',
                toolName: 'write_file',
                success: true,
            }],
            eventStoreRecords: [{
                type: 'tool_result',
                sessionId: 'session-store-usage',
                toolCallId: 'tool-usage-1',
                toolName: 'write_file',
                success: true,
                content: 'persisted tool output',
                timestamp: 1713513901000,
            }],
        });
        session.recordConversationEnvelopeEvent(eventEmitter.emit({
            type: 'message.completed',
            sessionId: 'session-store-usage',
            timestamp: Date.parse('2026-04-22T16:00:00.000Z'),
            source: 'agent',
            message: {
                id: 'session-store-usage:user:1',
                sessionId: 'session-store-usage',
                role: 'user',
                content: 'persist usage',
                createdAt: Date.parse('2026-04-22T16:00:00.000Z'),
            },
        }));
        session.recordConversationEnvelopeEvent(eventEmitter.emit({
            type: 'tool.output',
            sessionId: 'session-store-usage',
            timestamp: 1713513901000,
            source: 'tool',
            provider: 'local',
            tool: 'write_file',
            output: 'persisted tool output',
        }));
        session.recordConversationEnvelopeEvent(eventEmitter.emit({
            type: 'tool.completed',
            sessionId: 'session-store-usage',
            timestamp: 1713513901001,
            source: 'tool',
            provider: 'local',
            tool: 'write_file',
            success: true,
        }));
        session.recordConversationEnvelopeEvent(eventEmitter.emit({
            type: 'verification.completed',
            sessionId: 'session-store-usage',
            timestamp: Date.parse('2026-04-22T16:00:02.000Z'),
            source: 'agent',
            ok: true,
            blocked: false,
            summary: 'Verification passed: persisted across reload',
        }));
        session.recordConversationEnvelopeEvent(eventEmitter.emit({
            type: 'status.changed',
            sessionId: 'session-store-usage',
            timestamp: Date.parse('2026-04-22T16:00:03.000Z'),
            source: 'agent',
            status: 'done',
            stopReason: 'completed',
        }));

        const writer = new SQLiteSessionStore(dbPath);
        writer.saveSession({
            session,
            projectRoot,
            cwd: projectRoot,
            model: 'openai/gpt-4.1',
            title: 'Persist Usage',
        });
        writer.close();

        const reader = new SQLiteSessionStore(dbPath);
        const summary = reader.getSessionSummary('session-store-usage');
        const restored = reader.getSession('session-store-usage');
        reader.close();

        expect(summary?.usage).toMatchObject({
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        });
        expect(restored?.getUsage()).toMatchObject({
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        });
        expect(restored?.getVerificationHistory()).toEqual([{
            id: expect.any(String),
            ok: true,
            blocked: false,
            summary: 'Verification passed: persisted across reload',
            messages: ['Verification passed: persisted across reload'],
            createdAt: expect.any(Date),
        }]);
        expect(restored?.getCheckpointHistory()).toEqual([{
            id: 'checkpoint_tool-usage-1',
            toolCallId: 'tool-usage-1',
            toolName: 'write_file',
            required: true,
            status: 'captured',
            rollbackPointId: 'rollback_usage_1',
            timestamp: new Date('2026-04-22T16:00:00.000Z'),
        }]);
        expect(restored?.getToolResultRendererEvents()).toEqual([{
            type: 'tool.output',
            sessionId: 'session-store-usage',
            toolCallId: 'tool-usage-1',
            toolName: 'write_file',
            output: 'persisted tool output',
            timestamp: 1713513901000,
        }, {
            type: 'tool.completed',
            sessionId: 'session-store-usage',
            toolCallId: 'tool-usage-1',
            toolName: 'write_file',
            success: true,
            timestamp: 1713513901001,
        }]);
        expect(restored?.getToolResultTranscriptEntries()).toEqual([{
            type: 'tool',
            content: 'persisted tool output',
            toolCallId: 'tool-usage-1',
            toolName: 'write_file',
            success: true,
        }]);
        expect(restored?.getToolResultEventStoreRecords()).toEqual([{
            type: 'tool_result',
            sessionId: 'session-store-usage',
            toolCallId: 'tool-usage-1',
            toolName: 'write_file',
            success: true,
            content: 'persisted tool output',
            timestamp: 1713513901000,
        }]);
        expect(restored?.getConversationEvents()).toEqual([{
            type: 'user_message',
            sessionId: 'session-store-usage',
            seq: 0,
            timestamp: expect.any(Number),
            content: 'persist usage',
        }, {
            type: 'checkpoint',
            sessionId: 'session-store-usage',
            seq: 1,
            timestamp: new Date('2026-04-22T16:00:00.000Z').getTime(),
            checkpointId: 'checkpoint_tool-usage-1',
            toolCallId: 'tool-usage-1',
            toolName: 'write_file',
            required: true,
            status: 'captured',
            rollbackPointId: 'rollback_usage_1',
        }, {
            type: 'verification_result',
            sessionId: 'session-store-usage',
            seq: 2,
            timestamp: expect.any(Number),
            verificationId: expect.any(String),
            ok: true,
            blocked: false,
            summary: 'Verification passed: persisted across reload',
            content: 'Verification passed: persisted across reload',
        }, {
            type: 'tool_result',
            sessionId: 'session-store-usage',
            seq: 3,
            timestamp: 1713513901000,
            toolCallId: 'tool-usage-1',
            toolName: 'write_file',
            success: true,
            content: 'persisted tool output',
        }]);
        expect(restored?.getConversationEventEnvelopes()).toEqual([
            {
                schemaVersion: 1,
                eventId: 'session-store-usage:turn:persisted:event:1',
                sessionId: 'session-store-usage',
                turnId: 'session-store-usage:turn:persisted',
                timestamp: '2026-04-22T16:00:00.000Z',
                type: 'message.completed',
                payload: {
                    source: 'agent',
                    message: {
                        id: 'session-store-usage:user:1',
                        sessionId: 'session-store-usage',
                        role: 'user',
                        content: 'persist usage',
                        createdAt: Date.parse('2026-04-22T16:00:00.000Z'),
                    },
                },
            },
            {
                schemaVersion: 1,
                eventId: 'session-store-usage:turn:persisted:event:2',
                sessionId: 'session-store-usage',
                turnId: 'session-store-usage:turn:persisted',
                timestamp: new Date(1713513901000).toISOString(),
                type: 'tool.output',
                payload: {
                    source: 'tool',
                    provider: 'local',
                    tool: 'write_file',
                    output: 'persisted tool output',
                },
            },
            {
                schemaVersion: 1,
                eventId: 'session-store-usage:turn:persisted:event:3',
                sessionId: 'session-store-usage',
                turnId: 'session-store-usage:turn:persisted',
                timestamp: new Date(1713513901001).toISOString(),
                type: 'tool.completed',
                payload: {
                    source: 'tool',
                    provider: 'local',
                    tool: 'write_file',
                    success: true,
                },
            },
            {
                schemaVersion: 1,
                eventId: 'session-store-usage:turn:persisted:event:4',
                sessionId: 'session-store-usage',
                turnId: 'session-store-usage:turn:persisted',
                timestamp: '2026-04-22T16:00:02.000Z',
                type: 'verification.completed',
                payload: {
                    source: 'agent',
                    ok: true,
                    blocked: false,
                    summary: 'Verification passed: persisted across reload',
                },
            },
            {
                schemaVersion: 1,
                eventId: 'session-store-usage:turn:persisted:event:5',
                sessionId: 'session-store-usage',
                turnId: 'session-store-usage:turn:persisted',
                timestamp: '2026-04-22T16:00:03.000Z',
                type: 'status.changed',
                payload: {
                    source: 'agent',
                    status: 'done',
                    stopReason: 'completed',
                },
            },
        ]);
    });

    it('rebuilds conversation signals from envelopes without appending new legacy conversationEvents once the envelope stream is active', () => {
        const tempDir = createTempDir();
        const dbPath = path.join(tempDir, 'sessions.db');
        const projectRoot = path.join(tempDir, 'project');
        fs.mkdirSync(projectRoot, { recursive: true });

        const session = new AgentSession({
            id: 'session-store-envelope-primary',
            systemPrompt: 'system',
        });
        const eventEmitter = createConversationEventEnvelopeEmitter(
            'session-store-envelope-primary',
            'session-store-envelope-primary:turn:primary',
        );
        session.recordConversationEnvelopeEvent(eventEmitter.emit({
            type: 'message.completed',
            sessionId: 'session-store-envelope-primary',
            timestamp: Date.parse('2026-04-23T10:00:00.000Z'),
            source: 'agent',
            message: {
                id: 'session-store-envelope-primary:user:1',
                sessionId: 'session-store-envelope-primary',
                role: 'user',
                content: 'fresh envelope user',
                createdAt: Date.parse('2026-04-23T10:00:00.000Z'),
            },
        }));
        session.addUserMessage('legacy user snapshot that should not become conversationEvents');
        session.recordConversationEnvelopeEvent(eventEmitter.emit({
            type: 'message.completed',
            sessionId: 'session-store-envelope-primary',
            timestamp: Date.parse('2026-04-23T10:00:01.000Z'),
            source: 'agent',
            message: {
                id: 'session-store-envelope-primary:assistant:1',
                sessionId: 'session-store-envelope-primary',
                role: 'assistant',
                content: 'fresh envelope assistant',
                createdAt: Date.parse('2026-04-23T10:00:01.000Z'),
            },
        }));
        session.addAssistantMessage({
            role: 'assistant',
            content: 'legacy assistant snapshot that should not become conversationEvents',
        });

        expect(session.getConversationEvents()).toEqual([]);

        const writer = new SQLiteSessionStore(dbPath);
        writer.saveSession({
            session,
            projectRoot,
            cwd: projectRoot,
            model: 'openai/gpt-4.1',
            title: 'Envelope Primary',
        });
        writer.close();

        const reader = new SQLiteSessionStore(dbPath);
        const restored = reader.getSession('session-store-envelope-primary');
        reader.close();

        expect(restored?.getConversationEvents()).toEqual([]);
        expect(buildProjectedConversationTranscript({
            messages: restored?.getMessages() ?? [],
            conversationEventEnvelopes: restored?.getConversationEventEnvelopes(),
            conversationEvents: restored?.getConversationEvents(),
        })).toEqual([
            { type: 'user', content: 'fresh envelope user' },
            { type: 'assistant', content: 'fresh envelope assistant', response: 'fresh envelope assistant' },
        ]);
    });
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-session-usage-'));
    tempDirs.push(dir);
    return dir;
}
