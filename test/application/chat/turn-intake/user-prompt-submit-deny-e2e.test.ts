import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { ConfigManager } from '@xqoder/shared';
import { resolvePromptSubmissionOutcome } from '../../../../src/application/chat/turn-intake/submission-preprocess.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-prompt-e2e-'));
    tempDirs.push(dir);
    return dir;
}

describe('UserPromptSubmit hook e2e (P14c)', () => {
    it('blocks prompts matching /forbidden with a reason the UI can surface', async () => {
        const cwd = createTempDir();
        const scriptPath = path.join(cwd, 'deny-forbidden.sh');
        fs.writeFileSync(
            scriptPath,
            [
                '#!/bin/sh',
                'INPUT="$(cat)"',
                'case "$INPUT" in',
                '  *"/forbidden"*)',
                `    printf '%s' '${JSON.stringify({ decision: 'deny', reason: '/forbidden is not allowed by policy' })}'`,
                '    exit 0',
                '    ;;',
                'esac',
                "printf '%s' '{}'",
            ].join('\n'),
            { mode: 0o755 },
        );

        const configPath = path.join(cwd, '.xqoder', 'config.json');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({
            hooks: {
                UserPromptSubmit: [
                    { hooks: [{ type: 'command', command: scriptPath }] },
                ],
            },
        }, null, 2), 'utf-8');

        const manager = new ConfigManager({ configPath, cwd });

        const blocked = await resolvePromptSubmissionOutcome({
            prompt: 'please run /forbidden',
            cwd,
            sessionId: 'e2e-session',
            configManagerOverride: manager,
        });
        expect(blocked.status).toBe('blocked');
        if (blocked.status === 'blocked') {
            expect(blocked.response).toContain('/forbidden is not allowed');
            expect(blocked.sessionId).toBe('e2e-session');
        }

        const passed = await resolvePromptSubmissionOutcome({
            prompt: 'just a normal prompt',
            cwd,
            sessionId: 'e2e-session',
            configManagerOverride: manager,
        });
        expect(passed.status).toBe('proceed');
        if (passed.status === 'proceed') {
            expect(passed.prompt).toBe('just a normal prompt');
        }
    });
});
