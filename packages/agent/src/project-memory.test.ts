import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentSession } from './session/session.js';
import { syncProjectMemoryFromSession } from './project-memory.js';

const tempDirs: string[] = [];

function createTempProjectRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-project-memory-'));
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

describe('project-memory', () => {
    it('syncs recent commands, file changes, and tool outcomes into .xqoder/project-memory.json', () => {
        const projectRoot = createTempProjectRoot();
        const session = new AgentSession({
            id: 'session_project_memory',
            createdAt: new Date('2026-03-24T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'run tests and patch README' },
            ],
        });

        session.recordToolExecution({
            id: 'tool_cmd',
            name: 'run_command',
            args: { command: 'pnpm test' },
            success: true,
            output: 'all green',
            metadata: {
                command: 'pnpm test',
                cwd: projectRoot,
            },
        });
        session.recordToolExecution({
            id: 'tool_write',
            name: 'write_file',
            args: {
                path: 'README.md',
                content: '# Demo',
            },
            success: true,
            output: 'README updated',
            metadata: {
                path: path.join(projectRoot, 'README.md'),
                changeType: 'write',
                bytes: 6,
                existedBefore: true,
            },
        });

        const snapshot = syncProjectMemoryFromSession(
            projectRoot,
            session,
            new Date('2026-03-24T00:05:00.000Z'),
        );
        const persisted = JSON.parse(
            fs.readFileSync(path.join(projectRoot, '.xqoder', 'project-memory.json'), 'utf8'),
        ) as unknown;

        expect(snapshot).toMatchObject({
            version: 1,
            projectRoot,
            session: {
                sessionId: 'session_project_memory',
                recentCommands: [
                    {
                        command: 'pnpm test',
                        success: true,
                    },
                ],
                recentFileChanges: [
                    {
                        path: path.join(projectRoot, 'README.md'),
                        changeType: 'write',
                        success: true,
                    },
                ],
                recentTools: [
                    {
                        name: 'run_command',
                        success: true,
                    },
                    {
                        name: 'write_file',
                        success: true,
                    },
                ],
            },
        });
        expect(persisted).toEqual(snapshot);
    });
});
