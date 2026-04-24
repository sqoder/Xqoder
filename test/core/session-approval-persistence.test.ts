import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { createConversationEventEnvelopeEmitter } from '@xqoder/protocol';
import { AgentSession } from '../../src/core/agent/session/session.js';
import { SQLiteSessionStore } from '../../src/core/agent/session/store.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('session approval persistence', () => {
    it('tracks pending approvals from envelope events and persists resolved history', () => {
        const session = new AgentSession({
            id: 'session-approval-events',
            systemPrompt: 'system',
        });
        const emitter = createConversationEventEnvelopeEmitter(session.id, 'turn-approval-1');

        session.recordConversationEnvelopeEvent(emitter.emit({
            type: 'approval.requested',
            sessionId: session.id,
            timestamp: Date.parse('2026-04-24T10:00:00.000Z'),
            source: 'agent',
            requestId: 'tool-call-approval-1',
            kind: 'tool',
            summary: 'Edit file src/demo.ts',
            payload: {
                toolCallId: 'tool-call-approval-1',
                toolName: 'edit_file',
                summary: 'Edit file src/demo.ts',
                reason: 'Review edit diff',
                preview: '-old\n+new',
                risk: 'medium',
            },
        }));

        expect(session.getPendingApprovals()).toEqual([{
            requestId: 'tool-call-approval-1',
            toolCallId: 'tool-call-approval-1',
            toolName: 'edit_file',
            kind: 'tool',
            summary: 'Edit file src/demo.ts',
            reason: 'Review edit diff',
            preview: '-old\n+new',
            risk: 'medium',
            requestedAt: new Date('2026-04-24T10:00:00.000Z'),
            source: 'agent',
        }]);

        session.recordConversationEnvelopeEvent(emitter.emit({
            type: 'approval.resolved',
            sessionId: session.id,
            timestamp: Date.parse('2026-04-24T10:01:00.000Z'),
            source: 'agent',
            requestId: 'tool-call-approval-1',
            decision: 'allow',
        }));

        expect(session.getPendingApprovals()).toEqual([]);
        expect(session.getApprovalHistory()).toEqual([{
            requestId: 'tool-call-approval-1',
            toolCallId: 'tool-call-approval-1',
            toolName: 'edit_file',
            kind: 'tool',
            summary: 'Edit file src/demo.ts',
            reason: 'Review edit diff',
            preview: '-old\n+new',
            risk: 'medium',
            decision: 'allow',
            requestedAt: new Date('2026-04-24T10:00:00.000Z'),
            resolvedAt: new Date('2026-04-24T10:01:00.000Z'),
            source: 'agent',
        }]);
    });

    it('round-trips approval history and pending approvals through SQLite metadata', () => {
        const tempDir = createTempDir();
        const dbPath = path.join(tempDir, 'sessions.db');
        const projectRoot = path.join(tempDir, 'project');
        fs.mkdirSync(projectRoot, { recursive: true });
        const session = new AgentSession({
            id: 'session-approval-store',
            systemPrompt: 'system',
        });

        session.recordApprovalRequested({
            requestId: 'pending-approval-1',
            toolCallId: 'pending-approval-1',
            toolName: 'write_file',
            kind: 'tool',
            summary: 'Overwrite file demo.ts',
            requestedAt: new Date('2026-04-24T11:00:00.000Z'),
            source: 'http',
            streamId: 'stream-1',
        });
        session.recordApprovalResolved({
            requestId: 'resolved-approval-1',
            toolCallId: 'resolved-approval-1',
            toolName: 'run_shell',
            kind: 'tool',
            summary: 'Execute command: bun test',
            decision: 'deny',
            requestedAt: new Date('2026-04-24T11:01:00.000Z'),
            resolvedAt: new Date('2026-04-24T11:02:00.000Z'),
            source: 'http',
            streamId: 'stream-2',
        });

        const writer = new SQLiteSessionStore(dbPath);
        writer.saveSession({
            session,
            projectRoot,
            cwd: projectRoot,
            model: 'openai/gpt-4.1',
            title: 'Approvals',
        });
        writer.close();

        const reader = new SQLiteSessionStore(dbPath);
        const restored = reader.getSession(session.id);
        reader.close();

        expect(restored?.getPendingApprovals()).toMatchObject([{
            requestId: 'pending-approval-1',
            toolName: 'write_file',
            summary: 'Overwrite file demo.ts',
            streamId: 'stream-1',
        }]);
        expect(restored?.getApprovalHistory()).toMatchObject([{
            requestId: 'resolved-approval-1',
            toolName: 'run_shell',
            decision: 'deny',
            summary: 'Execute command: bun test',
            streamId: 'stream-2',
        }]);
    });

    it('keeps pending approvals with the same request id isolated by stream id', () => {
        const session = new AgentSession({
            id: 'session-approval-stream-isolation',
            systemPrompt: 'system',
        });

        session.recordApprovalRequested({
            requestId: 'tool-call-shared',
            toolCallId: 'tool-call-shared',
            toolName: 'edit_file',
            kind: 'tool',
            summary: 'Edit from stream A',
            requestedAt: new Date('2026-04-24T12:00:00.000Z'),
            source: 'http',
            streamId: 'stream-a',
        });
        session.recordApprovalRequested({
            requestId: 'tool-call-shared',
            toolCallId: 'tool-call-shared',
            toolName: 'write_file',
            kind: 'tool',
            summary: 'Write from stream B',
            requestedAt: new Date('2026-04-24T12:01:00.000Z'),
            source: 'http',
            streamId: 'stream-b',
        });

        expect(session.getPendingApprovals().map((entry) => ({
            requestId: entry.requestId,
            streamId: entry.streamId,
            summary: entry.summary,
        }))).toEqual([
            {
                requestId: 'tool-call-shared',
                streamId: 'stream-a',
                summary: 'Edit from stream A',
            },
            {
                requestId: 'tool-call-shared',
                streamId: 'stream-b',
                summary: 'Write from stream B',
            },
        ]);

        session.recordApprovalResolved({
            requestId: 'tool-call-shared',
            toolCallId: 'tool-call-shared',
            toolName: 'edit_file',
            kind: 'tool',
            summary: 'Edit from stream A',
            decision: 'allow',
            requestedAt: new Date('2026-04-24T12:00:00.000Z'),
            resolvedAt: new Date('2026-04-24T12:02:00.000Z'),
            source: 'http',
            streamId: 'stream-a',
        });

        expect(session.getPendingApprovals().map((entry) => ({
            requestId: entry.requestId,
            streamId: entry.streamId,
            summary: entry.summary,
        }))).toEqual([{
            requestId: 'tool-call-shared',
            streamId: 'stream-b',
            summary: 'Write from stream B',
        }]);
        expect(session.getApprovalHistory().map((entry) => ({
            requestId: entry.requestId,
            streamId: entry.streamId,
            decision: entry.decision,
            summary: entry.summary,
        }))).toEqual([{
            requestId: 'tool-call-shared',
            streamId: 'stream-a',
            decision: 'allow',
            summary: 'Edit from stream A',
        }]);
    });
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-session-approval-'));
    tempDirs.push(dir);
    return dir;
}
