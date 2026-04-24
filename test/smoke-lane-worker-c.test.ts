import { describe, expect, it, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { IdeBridge } from '../src/application/system/ide.js';
import { createConversationEventEnvelopeEmitter } from '@xqoder/protocol';
import { toConversationEvent } from '../src/application/chat/conversation-events.js';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-worker-c-test-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('Worker C - IDE System Smoke', () => {
    it('IdeBridge correctly restores state from the well-known project location', async () => {
        const workspaceRoot = createTempDir();
        const bridge = new IdeBridge(workspaceRoot);

        // Ensure directory exists
        const ideDir = path.join(workspaceRoot, '.xqoder', 'ide');
        fs.mkdirSync(ideDir, { recursive: true });

        const mockState = {
            activeFile: '/src/main.ts',
            selection: {
                start: { line: 10, character: 0 },
                end: { line: 12, character: 5 }
            },
            diagnostics: [
                {
                    file: '/src/main.ts',
                    line: 11,
                    column: 4,
                    severity: 'error',
                    message: 'Syntax error'
                }
            ]
        };

        fs.writeFileSync(path.join(ideDir, 'state.json'), JSON.stringify(mockState));

        const state = await bridge.getActiveState();
        expect(state.activeFile).toBe('/src/main.ts');
        expect(state.diagnostics).toHaveLength(1);
        expect(state.diagnostics[0].message).toBe('Syntax error');
    });

    it('IdeBridge correctly restores diagnostics from the well-known project location', async () => {
        const workspaceRoot = createTempDir();
        const bridge = new IdeBridge(workspaceRoot);

        const ideDir = path.join(workspaceRoot, '.xqoder', 'ide');
        fs.mkdirSync(ideDir, { recursive: true });

        const mockDiagnostics = [
            {
                file: '/src/utils.ts',
                line: 5,
                column: 2,
                severity: 'warning',
                message: 'Unused variable'
            }
        ];

        fs.writeFileSync(path.join(ideDir, 'diagnostics.json'), JSON.stringify(mockDiagnostics));

        const diagnostics = await bridge.getWorkspaceDiagnostics();
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].message).toBe('Unused variable');
    });

    it('IdeBridge writes pending edits to the well-known project location', async () => {
        const workspaceRoot = createTempDir();
        const bridge = new IdeBridge(workspaceRoot);

        const edits = [
            {
                file: '/src/index.ts',
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 }
                },
                newText: '// Injected comment\n'
            }
        ];

        const result = await bridge.applyEdits(edits);
        expect(result.success).toBe(true);

        const editsPath = path.join(workspaceRoot, '.xqoder', 'ide', 'edits-pending.json');
        expect(fs.existsSync(editsPath)).toBe(true);
        const savedEdits = JSON.parse(fs.readFileSync(editsPath, 'utf8'));
        expect(savedEdits).toEqual(edits);
    });

    it('maps approval.requested and question.requested events for IDE panel consumption', () => {
        const sessionId = 'session-ide-events';
        const timestamp = Date.now();
        const eventEmitter = createConversationEventEnvelopeEmitter(sessionId, `${sessionId}:turn:1`);

        const approvalEnvelope = eventEmitter.emit({
            type: 'approval.requested',
            sessionId,
            timestamp,
            source: 'agent',
            requestId: 'req-1',
            kind: 'tool_approval',
            summary: 'Allow file write?',
            payload: { path: 'a.txt' }
        });

        // Current toConversationEvent implementation might not map these to a specific legacy type,
        // but we want to ensure the envelope itself is correctly structured as expected by chat-panel.ts.
        // chat-panel.ts directly handles StreamWireRecord which contains these events.

        expect(approvalEnvelope.type).toBe('approval.requested');
        expect(approvalEnvelope.payload).toMatchObject({
            requestId: 'req-1',
            kind: 'tool_approval',
            summary: 'Allow file write?',
            payload: { path: 'a.txt' }
        });

        const questionEnvelope = eventEmitter.emit({
            type: 'question.requested',
            sessionId,
            timestamp,
            source: 'agent',
            requestId: 'q-1',
            question: 'Which model to use?',
            options: [{ label: 'gpt-4' }, { label: 'claude-3' }]
        });

        expect(questionEnvelope.type).toBe('question.requested');
        expect(questionEnvelope.payload).toMatchObject({
            requestId: 'q-1',
            question: 'Which model to use?',
            options: [{ label: 'gpt-4' }, { label: 'claude-3' }]
        });
    });
});
