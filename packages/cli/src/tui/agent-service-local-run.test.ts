import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import { prepareLocalAgentRun } from './agent-service-local-run.js';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-agent-service-local-run-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('prepareLocalAgentRun', () => {
    it('resolves an existing session through the snapshot-first callback', async () => {
        const existingSession = new AgentSession({
            id: 'session-existing',
            title: 'Existing Session',
            createdAt: new Date('2026-03-24T00:00:00.000Z'),
            messages: [{ role: 'system', content: 'system prompt' }],
        });
        const resolveExistingSession = vi.fn().mockResolvedValue(existingSession);

        const prepared = await prepareLocalAgentRun({
            sessionId: existingSession.id,
            settings: {
                dir: createTempDir(),
                model: 'gpt-4.1',
                agent: 'general',
            },
            resolveExistingSession,
        });

        expect(resolveExistingSession).toHaveBeenCalledWith(existingSession.id);
        expect(prepared.loadedSession?.id).toBe(existingSession.id);
        expect(prepared.activeSession.id).toBe(existingSession.id);
        expect(prepared.crashCheckpoint.title).toBe('Existing Session');
    });
});
