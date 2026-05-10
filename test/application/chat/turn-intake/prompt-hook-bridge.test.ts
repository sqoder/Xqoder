import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import type { HooksSettings } from '@xqoder/shared';
import { dispatchUserPromptSubmit } from '../../../../src/application/chat/turn-intake/prompt-hook-bridge.js';

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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-hook-'));
    tempDirs.push(dir);
    return dir;
}

function writeScript(dir: string, name: string, body: string): string {
    const scriptPath = path.join(dir, name);
    fs.writeFileSync(scriptPath, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return scriptPath;
}

describe('dispatchUserPromptSubmit', () => {
    it('returns unchanged input when no UserPromptSubmit hook is configured', async () => {
        const cwd = createTempDir();
        const result = await dispatchUserPromptSubmit({
            text: 'hello',
            attachments: [],
            cwd,
            projectRoot: cwd,
            sessionId: 'sess',
            hooks: undefined,
        });
        expect(result).toEqual({ text: 'hello', attachments: [] });
    });

    it('returns blocked when a command hook replies with decision=deny', async () => {
        const cwd = createTempDir();
        const script = writeScript(cwd, 'deny.sh', `echo '{"decision":"deny","reason":"policy violation"}'`);
        const hooks: HooksSettings = {
            UserPromptSubmit: [
                { hooks: [{ type: 'command', command: script }] },
            ],
        };
        const result = await dispatchUserPromptSubmit({
            text: 'do dangerous thing',
            attachments: [],
            cwd,
            projectRoot: cwd,
            sessionId: 'sess',
            hooks,
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('policy violation');
    });

    it('rewrites the prompt when hook returns rewritten text', async () => {
        const cwd = createTempDir();
        const script = writeScript(cwd, 'rewrite.sh', `echo '{"rewritten":"please rephrase nicely"}'`);
        const hooks: HooksSettings = {
            UserPromptSubmit: [
                { hooks: [{ type: 'command', command: script }] },
            ],
        };
        const result = await dispatchUserPromptSubmit({
            text: 'original prompt',
            attachments: [],
            cwd,
            projectRoot: cwd,
            sessionId: 'sess',
            hooks,
        });
        expect(result.blocked).toBeUndefined();
        expect(result.text).toBe('please rephrase nicely');
    });

    it('passes through when hook returns {} (no action)', async () => {
        const cwd = createTempDir();
        const script = writeScript(cwd, 'noop.sh', `echo '{}'`);
        const hooks: HooksSettings = {
            UserPromptSubmit: [
                { hooks: [{ type: 'command', command: script }] },
            ],
        };
        const result = await dispatchUserPromptSubmit({
            text: 'stay the same',
            attachments: [],
            cwd,
            projectRoot: cwd,
            sessionId: 'sess',
            hooks,
        });
        expect(result.text).toBe('stay the same');
        expect(result.blocked).toBeUndefined();
    });

    it('treats malformed JSON as a no-op (fail-open)', async () => {
        const cwd = createTempDir();
        const script = writeScript(cwd, 'bad.sh', `echo 'not json at all'`);
        const hooks: HooksSettings = {
            UserPromptSubmit: [
                { hooks: [{ type: 'command', command: script }] },
            ],
        };
        const result = await dispatchUserPromptSubmit({
            text: 'ok prompt',
            attachments: [],
            cwd,
            projectRoot: cwd,
            sessionId: 'sess',
            hooks,
        });
        expect(result.text).toBe('ok prompt');
        expect(result.blocked).toBeUndefined();
    });

    it('blocks when decision=block as well', async () => {
        const cwd = createTempDir();
        const script = writeScript(cwd, 'block.sh', `echo '{"decision":"block","reason":"stop"}'`);
        const hooks: HooksSettings = {
            UserPromptSubmit: [
                { hooks: [{ type: 'command', command: script }] },
            ],
        };
        const result = await dispatchUserPromptSubmit({
            text: 'x',
            attachments: [],
            cwd,
            projectRoot: cwd,
            sessionId: 'sess',
            hooks,
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('stop');
    });
});
