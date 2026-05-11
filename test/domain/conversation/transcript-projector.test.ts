import { describe, expect, it } from 'bun:test';
import { createConversationEventEnvelopeEmitter } from '@xqoder/protocol';
import { AgentSession } from '../../../src/core/agent/session/session.js';
import { buildConversationTranscript } from '../../../src/domain/conversation/messages.js';
import { buildProjectedConversationTranscript } from '../../../src/domain/conversation/transcript-projector.js';

describe('transcript projector', () => {
    it('keeps event-store projected user/assistant/tool bodies aligned with the legacy snapshot transcript', () => {
        const session = new AgentSession({
            id: 'transcript-projector-parity',
            systemPrompt: 'system',
        });

        session.addUserMessage('inspect transcript parity');
        session.recordToolExecution({
            id: 'tool-parity-1',
            name: 'write_file',
            args: { path: 'src/parity.ts' },
            success: true,
            output: 'patched parity path',
            startedAt: new Date('2026-04-22T16:10:00.000Z'),
            completedAt: new Date('2026-04-22T16:10:01.000Z'),
        });
        session.recordCheckpoint({
            toolCallId: 'tool-parity-1',
            toolName: 'write_file',
            required: true,
            status: 'captured',
            rollbackPointId: 'rollback_parity_1',
            timestamp: new Date('2026-04-22T16:10:01.000Z'),
        });
        session.addToolResult('tool-parity-1', 'patched parity path');
        session.addMessage({
            role: 'system',
            content: 'Verification passed: transcript projector parity',
        });
        session.recordVerification({
            id: 'verification-parity-1',
            ok: true,
            blocked: false,
            summary: 'Verification passed: transcript projector parity',
            messages: ['Verification passed: transcript projector parity'],
            createdAt: new Date('2026-04-22T16:10:02.000Z'),
        });
        session.addAssistantMessage({
            role: 'assistant',
            content: 'transcript parity verified',
        });

        const legacy = buildConversationTranscript({
            messages: session.getMessages().map((message) => ({
                role: message.role,
                content: String(message.content ?? ''),
                ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
            })),
            toolHistory: session.getToolHistory().map((entry) => ({
                id: entry.id,
                name: entry.name,
                success: entry.success,
            })),
            verificationHistory: session.getVerificationHistory().map((entry) => ({
                id: entry.id,
                ok: entry.ok,
                blocked: entry.blocked,
                summary: entry.summary,
                messages: entry.messages,
            })),
        });
        const projected = buildProjectedConversationTranscript({
            messages: session.getMessages().map((message) => ({
                role: message.role,
                content: String(message.content ?? ''),
                ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
            })),
            toolHistory: session.getToolHistory().map((entry) => ({
                id: entry.id,
                name: entry.name,
                success: entry.success,
            })),
            verificationHistory: session.getVerificationHistory().map((entry) => ({
                id: entry.id,
                ok: entry.ok,
                blocked: entry.blocked,
                summary: entry.summary,
                messages: entry.messages,
            })),
            conversationEvents: session.getConversationEvents(),
        });

        expect(projected.filter(isTranscriptBodyEntry)).toEqual(
            legacy.filter(isTranscriptBodyEntry),
        );
        expect(projected).toEqual(expect.arrayContaining([{
            type: 'verification',
            content: 'Verification passed: transcript projector parity',
            ok: true,
            blocked: false,
            summary: 'Verification passed: transcript projector parity',
        }]));
    });

    it('replays transcript bodies from the persisted envelope event store with terminal events ignored for transcript projection', () => {
        const sessionId = 'transcript-projector-envelope-parity';
        const turnId = `${sessionId}:turn:parity`;
        const eventEmitter = createConversationEventEnvelopeEmitter(sessionId, turnId);
        const projected = buildProjectedConversationTranscript({
            messages: [],
            conversationEventEnvelopes: [
                eventEmitter.emit({
                    type: 'message.completed',
                    sessionId,
                    timestamp: Date.parse('2026-04-23T09:00:00.000Z'),
                    source: 'agent',
                    message: {
                        id: `${sessionId}:user:1`,
                        sessionId,
                        role: 'user',
                        content: 'inspect envelope replay parity',
                        createdAt: Date.parse('2026-04-23T09:00:00.000Z'),
                    },
                }),
                eventEmitter.emit({
                    type: 'tool.output',
                    sessionId,
                    timestamp: Date.parse('2026-04-23T09:00:01.000Z'),
                    source: 'tool',
                    provider: 'local',
                    tool: 'write_file',
                    output: 'patched envelope parity path',
                }),
                eventEmitter.emit({
                    type: 'tool.completed',
                    sessionId,
                    timestamp: Date.parse('2026-04-23T09:00:01.100Z'),
                    source: 'tool',
                    provider: 'local',
                    tool: 'write_file',
                    success: true,
                }),
                eventEmitter.emit({
                    type: 'verification.completed',
                    sessionId,
                    timestamp: Date.parse('2026-04-23T09:00:02.000Z'),
                    source: 'agent',
                    ok: true,
                    blocked: false,
                    summary: 'Verification passed: envelope replay parity',
                }),
                eventEmitter.emit({
                    type: 'message.completed',
                    sessionId,
                    timestamp: Date.parse('2026-04-23T09:00:03.000Z'),
                    source: 'agent',
                    message: {
                        id: `${sessionId}:assistant:1`,
                        sessionId,
                        role: 'assistant',
                        content: 'envelope replay parity verified',
                        createdAt: Date.parse('2026-04-23T09:00:03.000Z'),
                    },
                }),
                eventEmitter.emit({
                    type: 'status.changed',
                    sessionId,
                    timestamp: Date.parse('2026-04-23T09:00:04.000Z'),
                    source: 'agent',
                    status: 'done',
                    stopReason: 'completed',
                }),
            ],
        });

        expect(projected).toEqual([
            { type: 'user', content: 'inspect envelope replay parity' },
            {
                type: 'tool',
                content: 'patched envelope parity path',
                toolName: 'write_file',
                success: true,
            },
            {
                type: 'verification',
                content: 'Verification passed: envelope replay parity',
                ok: true,
                blocked: false,
                summary: 'Verification passed: envelope replay parity',
            },
            { type: 'assistant', content: 'envelope replay parity verified', response: 'envelope replay parity verified' },
        ]);
    });

    it('prefers envelope replay over legacy conversationEvents when both sources are present', () => {
        const sessionId = 'transcript-projector-envelope-primary';
        const eventEmitter = createConversationEventEnvelopeEmitter(
            sessionId,
            `${sessionId}:turn:primary`,
        );
        const projected = buildProjectedConversationTranscript({
            messages: [],
            conversationEvents: [{
                type: 'user_message',
                sessionId,
                seq: 0,
                timestamp: Date.parse('2026-04-23T10:00:00.000Z'),
                content: 'stale legacy user',
            }, {
                type: 'assistant_message',
                sessionId,
                seq: 1,
                timestamp: Date.parse('2026-04-23T10:00:01.000Z'),
                content: 'stale legacy assistant',
            }],
            conversationEventEnvelopes: [
                eventEmitter.emit({
                    type: 'message.completed',
                    sessionId,
                    timestamp: Date.parse('2026-04-23T10:00:00.000Z'),
                    source: 'agent',
                    message: {
                        id: `${sessionId}:user:1`,
                        sessionId,
                        role: 'user',
                        content: 'fresh envelope user',
                        createdAt: Date.parse('2026-04-23T10:00:00.000Z'),
                    },
                }),
                eventEmitter.emit({
                    type: 'message.completed',
                    sessionId,
                    timestamp: Date.parse('2026-04-23T10:00:01.000Z'),
                    source: 'agent',
                    message: {
                        id: `${sessionId}:assistant:1`,
                        sessionId,
                        role: 'assistant',
                        content: 'fresh envelope assistant',
                        createdAt: Date.parse('2026-04-23T10:00:01.000Z'),
                    },
                }),
            ],
        });

        expect(projected).toEqual([
            { type: 'user', content: 'fresh envelope user' },
            { type: 'assistant', content: 'fresh envelope assistant', response: 'fresh envelope assistant' },
        ]);
    });
});

function isTranscriptBodyEntry(
    entry: ReturnType<typeof buildProjectedConversationTranscript>[number],
): entry is Extract<ReturnType<typeof buildProjectedConversationTranscript>[number], { type: 'user' | 'assistant' | 'tool' }> {
    return entry.type === 'user' || entry.type === 'assistant' || entry.type === 'tool';
}
