import { describe, expect, it } from 'bun:test';
import { createConversationEventEnvelopeEmitter } from '@xqoder/protocol';
import {
    formatSessionDetail,
    formatSessionListLine,
} from '../../../src/application/sessions/session-output.js';
import type {
    SessionDetail,
    SessionSummary,
} from '../../../src/application/sessions/ports.js';

describe('session output usage visibility', () => {
    it('renders cache and cost fields in session list lines', () => {
        const line = formatSessionListLine(createSummary());

        expect(line).toContain('tokens=26');
        expect(line).toContain('cacheRead=8');
        expect(line).toContain('cacheCreate=3');
        expect(line).toContain('cost=$0.45');
    });

    it('renders a rich usage summary in session detail output', () => {
        const output = formatSessionDetail(createSummary(), createDetail(), 5, 5);

        expect(output).toContain('Usage: prompt=21, completion=5, total=26, cacheRead=8, cacheCreate=3, cost=$0.45');
        expect(output).toContain('Last User Message: show me the usage path');
    });

    it('renders conversation signals with tool and verification entries in session detail output', () => {
        const output = formatSessionDetail(createSummary(), createDetail(), 5, 5);

        expect(output).toContain('Conversation Signals:');
        expect(output).toContain('[tool:write_file] applied usage summary patch');
        expect(output).toContain('[verification:ok] Verification passed: usage is visible in session detail');
        expect(output).toContain('Approval History:');
        expect(output).toContain('pending write_file Overwrite file src/demo.ts');
        expect(output).toContain('allow edit_file Edit file src/demo.ts');
        expect(output).toContain('Checkpoint History:');
        expect(output).toContain('write_file status=captured rollback=rollback_usage_visible');
    });

    it('prefers envelope-backed conversation signals over legacy conversationEvents in session detail output', () => {
        const sessionId = 'session-envelope-visible';
        const eventEmitter = createConversationEventEnvelopeEmitter(
            sessionId,
            `${sessionId}:turn:1`,
        );
        const output = formatSessionDetail(createSummary(), {
            id: sessionId,
            getMessages: () => [],
            getCommandHistory: () => [],
            getFileChanges: () => [],
            getToolHistory: () => [],
            getVerificationHistory: () => [],
            getCheckpointHistory: () => [],
            getConversationEvents: () => [{
                type: 'assistant_message',
                sessionId,
                seq: 0,
                timestamp: Date.parse('2026-04-23T10:10:00.000Z'),
                content: 'stale legacy assistant',
            }],
            getConversationEventEnvelopes: () => [
                eventEmitter.emit({
                    type: 'message.completed',
                    sessionId,
                    timestamp: Date.parse('2026-04-23T10:10:00.000Z'),
                    source: 'agent',
                    message: {
                        id: `${sessionId}:assistant:1`,
                        sessionId,
                        role: 'assistant',
                        content: 'fresh envelope assistant',
                        createdAt: Date.parse('2026-04-23T10:10:00.000Z'),
                    },
                }),
            ],
            getCompactSummary: () => undefined,
        }, 5, 5);

        expect(output).toContain('[assistant] fresh envelope assistant');
        expect(output).not.toContain('stale legacy assistant');
    });
});

function createSummary(): SessionSummary {
    return {
        id: 'session-usage-visible',
        projectRoot: '/workspace/demo',
        cwd: '/workspace/demo',
        model: 'openai/gpt-4.1',
        title: 'Usage Visible',
        createdAt: new Date('2026-04-20T08:00:00.000Z'),
        updatedAt: new Date('2026-04-20T08:05:00.000Z'),
        maxMessages: 64,
        messageCount: 2,
        usage: {
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        },
        lastUserMessage: 'show me the usage path',
        compactionCount: 1,
        commandCount: 2,
        fileChangeCount: 1,
    };
}

function createDetail(): SessionDetail {
    return {
        id: 'session-usage-visible',
        getMessages: () => [
            { role: 'user', content: 'show me the usage path' },
            { role: 'tool', content: 'applied usage summary patch', toolCallId: 'tool-usage-1' } as any,
            { role: 'system', content: 'Verification passed: usage is visible in session detail' },
            { role: 'assistant', content: 'usage is now visible in session output' },
        ],
        getCommandHistory: () => [],
        getFileChanges: () => [],
        getToolHistory: () => [{
            id: 'tool-usage-1',
            completedAt: new Date('2026-04-20T08:03:00.000Z'),
            success: true,
            name: 'write_file',
            args: {},
            outputPreview: 'applied usage summary patch',
        }],
        getVerificationHistory: () => [{
            createdAt: new Date('2026-04-20T08:04:00.000Z'),
            ok: true,
            blocked: false,
            summary: 'Verification passed: usage is visible in session detail',
            messages: ['Verification passed: usage is visible in session detail'],
        }],
        getCheckpointHistory: () => [{
            timestamp: new Date('2026-04-20T08:03:00.000Z'),
            toolCallId: 'tool-usage-1',
            toolName: 'write_file',
            required: true,
            status: 'captured',
            rollbackPointId: 'rollback_usage_visible',
        }],
        getPendingApprovals: () => [{
            requestId: 'approval-pending-1',
            toolCallId: 'approval-pending-1',
            toolName: 'write_file',
            kind: 'tool',
            summary: 'Overwrite file src/demo.ts',
            requestedAt: new Date('2026-04-20T08:02:00.000Z'),
            source: 'agent',
        }],
        getApprovalHistory: () => [{
            requestId: 'approval-history-1',
            toolCallId: 'approval-history-1',
            toolName: 'edit_file',
            kind: 'tool',
            summary: 'Edit file src/demo.ts',
            decision: 'allow',
            requestedAt: new Date('2026-04-20T08:01:00.000Z'),
            resolvedAt: new Date('2026-04-20T08:01:20.000Z'),
            source: 'agent',
        }],
        getCompactSummary: () => 'usage propagated into persisted surfaces',
    };
}
