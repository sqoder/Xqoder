import { describe, expect, it } from 'bun:test';
import { AgentSession } from '@xqoder/storage-sqlite';
import {
    createImportedSession,
    createSessionExportDocument,
    parseSessionExportDocument,
    renderSessionMarkdown,
} from '../../../src/features/sessions/assets.js';

describe('session asset export usage visibility', () => {
    it('preserves rich usage fields in export JSON and imported sessions', () => {
        const session = createSession();
        const summary = createSummary(session);

        const document = createSessionExportDocument(summary, session);
        const imported = createImportedSession(
            parseSessionExportDocument(JSON.parse(JSON.stringify(document))),
            'session-imported-usage',
        );

        expect(document.summary.usage).toMatchObject({
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        });
        expect(document.snapshot.usage).toMatchObject({
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        });
        expect(imported.getUsage()).toMatchObject({
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        });
        expect(imported.getCheckpointHistory()).toEqual([{
            id: 'checkpoint_tool-export-1',
            toolCallId: 'tool-export-1',
            toolName: 'write_file',
            required: true,
            status: 'captured',
            rollbackPointId: 'rollback_export_1',
            timestamp: new Date('2026-04-20T08:02:00.000Z'),
        }]);
    });

    it('renders usage in exported markdown assets', () => {
        const session = createSession();
        const summary = createSummary(session);

        const markdown = renderSessionMarkdown(summary, session);

        expect(markdown).toContain('- Usage: prompt=21, completion=5, total=26, cacheRead=8, cacheCreate=3, cost=$0.45');
        expect(markdown).toContain('## Conversation Signals');
        expect(markdown).toContain('[tool:write_file] patched exported assets');
        expect(markdown).toContain('[verification:ok] Verification passed: exported assets include usage');
        expect(markdown).toContain('## Recent Transcript');
    });

    it('includes a derived conversation transcript in exported json assets', () => {
        const session = createSession();
        const summary = createSummary(session);

        const document = createSessionExportDocument(summary, session);

        expect(document.snapshot.transcript).toEqual(expect.arrayContaining([
            {
                type: 'user',
                content: 'show exported usage',
            },
            {
                type: 'tool',
                content: 'patched exported assets',
                toolCallId: 'tool-export-1',
                toolName: 'write_file',
                success: true,
            },
            {
                type: 'verification',
                content: 'Verification passed: exported assets include usage',
                ok: true,
                blocked: false,
                summary: 'Verification passed: exported assets include usage',
            },
            {
                type: 'assistant',
                content: 'usage is visible in exported assets',
                response: 'usage is visible in exported assets',
            },
        ]));
    });
});

function createSession(): AgentSession {
    const session = new AgentSession({
        id: 'session-export-usage',
        title: 'Usage Export',
        systemPrompt: 'system',
        createdAt: new Date('2026-04-20T08:00:00.000Z'),
        maxMessages: 64,
    });
    session.addUserMessage('show exported usage');
    session.recordToolExecution({
        id: 'tool-export-1',
        name: 'write_file',
        args: { path: 'src/session.ts' },
        success: true,
        output: 'patched exported assets',
        startedAt: new Date('2026-04-20T08:02:00.000Z'),
        completedAt: new Date('2026-04-20T08:02:00.000Z'),
    });
    session.recordCheckpoint({
        toolCallId: 'tool-export-1',
        toolName: 'write_file',
        required: true,
        status: 'captured',
        rollbackPointId: 'rollback_export_1',
        timestamp: new Date('2026-04-20T08:02:00.000Z'),
    });
    session.addToolResult('tool-export-1', 'patched exported assets');
    session.addMessage({
        role: 'system',
        content: 'Verification passed: exported assets include usage',
    });
    session.recordVerification({
        ok: true,
        blocked: false,
        summary: 'Verification passed: exported assets include usage',
        messages: ['Verification passed: exported assets include usage'],
    });
    session.addAssistantMessage({ role: 'assistant', content: 'usage is visible in exported assets' });
    session.recordUsage({
        promptTokens: 21,
        completionTokens: 5,
        totalTokens: 26,
        cacheReadTokens: 8,
        cacheCreationTokens: 3,
        cost: 0.45,
    });
    return session;
}

function createSummary(session: AgentSession) {
    const usage = session.getUsage();

    return {
        id: session.id,
        projectRoot: '/workspace/demo',
        cwd: '/workspace/demo',
        model: 'openai/gpt-4.1',
        title: 'Usage Export',
        createdAt: new Date('2026-04-20T08:00:00.000Z'),
        updatedAt: new Date('2026-04-20T08:05:00.000Z'),
        maxMessages: 64,
        messageCount: session.getMessages().length,
        usage,
        lastUserMessage: 'show exported usage',
        compactionCount: 0,
        commandCount: session.getCommandHistory().length,
        fileChangeCount: session.getFileChanges().length,
    };
}
