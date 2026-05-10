import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { ConfigManager, type HooksSettings } from '@xqoder/shared';
import {
    runAddHookCommand,
    runRemoveHookCommand,
} from '../../../src/application/system/hooks.js';
import { runTestHookCommand } from '../../../src/application/integrations/hooks-test.js';

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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-hooks-cli-'));
    tempDirs.push(dir);
    return dir;
}

function writeConfig(configPath: string, config: unknown): void {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function capture(): { write: (text: string) => void; output: string[] } {
    const output: string[] = [];
    return {
        write: (text: string) => output.push(text),
        output,
    };
}

describe('runAddHookCommand (P14c)', () => {
    it('appends a command hook to a fresh event group and persists to disk', () => {
        const cwd = createTempDir();
        const configPath = path.join(cwd, '.xqoder', 'config.json');
        writeConfig(configPath, {});
        const manager = new ConfigManager({ configPath });
        const capturer = capture();

        const result = runAddHookCommand(
            { type: 'command', command: './bin/filter.sh' },
            { event: 'UserPromptSubmit' },
            { writeOutput: capturer.write },
            manager,
        );

        expect(result.mutation).toBe('added');
        expect(result.event).toBe('UserPromptSubmit');
        expect(result.handlerCount).toBe(1);

        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw) as { hooks?: HooksSettings };
        expect(parsed.hooks?.UserPromptSubmit).toHaveLength(1);
        expect(parsed.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]).toEqual(expect.objectContaining({
            type: 'command',
            command: './bin/filter.sh',
        }));
    });

    it('groups handlers by matcher', () => {
        const cwd = createTempDir();
        const configPath = path.join(cwd, '.xqoder', 'config.json');
        writeConfig(configPath, {});
        const manager = new ConfigManager({ configPath });

        runAddHookCommand(
            { type: 'command', command: 'echo one' },
            { event: 'PreToolUse', matcher: 'read_file' },
            {},
            manager,
        );
        runAddHookCommand(
            { type: 'command', command: 'echo two' },
            { event: 'PreToolUse', matcher: 'read_file' },
            {},
            manager,
        );
        runAddHookCommand(
            { type: 'command', command: 'echo three' },
            { event: 'PreToolUse' },
            {},
            manager,
        );

        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { hooks?: HooksSettings };
        const groups = parsed.hooks?.PreToolUse ?? [];
        expect(groups).toHaveLength(2);
        const byMatcher = new Map(groups.map((group) => [group.matcher ?? '', group.hooks.length]));
        expect(byMatcher.get('read_file')).toBe(2);
        expect(byMatcher.get('')).toBe(1);
    });

    it('rejects unknown event names', () => {
        const cwd = createTempDir();
        const configPath = path.join(cwd, '.xqoder', 'config.json');
        writeConfig(configPath, {});
        const manager = new ConfigManager({ configPath });
        expect(() => runAddHookCommand(
            { type: 'command', command: 'noop' },
            { event: 'NotARealEvent' },
            {},
            manager,
        )).toThrow(/Unsupported hook event/);
    });
});

describe('runRemoveHookCommand (P14c)', () => {
    it('removes a handler by flat index and collapses empty groups', () => {
        const cwd = createTempDir();
        const configPath = path.join(cwd, '.xqoder', 'config.json');
        writeConfig(configPath, {
            hooks: {
                SessionStart: [
                    { hooks: [{ type: 'command', command: 'echo a' }] },
                    { hooks: [{ type: 'command', command: 'echo b' }] },
                ],
            },
        });
        const manager = new ConfigManager({ configPath });

        const result = runRemoveHookCommand({ event: 'SessionStart', index: 0 }, {}, manager);
        expect(result.mutation).toBe('removed');
        expect(result.handlerCount).toBe(1);

        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { hooks?: HooksSettings };
        expect(parsed.hooks?.SessionStart).toHaveLength(1);
        expect(parsed.hooks?.SessionStart?.[0]?.hooks?.[0]?.type === 'command'
            ? parsed.hooks.SessionStart[0].hooks[0].command
            : undefined,
        ).toBe('echo b');
    });

    it('errors when the index is out of range', () => {
        const cwd = createTempDir();
        const configPath = path.join(cwd, '.xqoder', 'config.json');
        writeConfig(configPath, {
            hooks: {
                Stop: [{ hooks: [{ type: 'command', command: 'echo only' }] }],
            },
        });
        const manager = new ConfigManager({ configPath });
        expect(() => runRemoveHookCommand({ event: 'Stop', index: 5 }, {}, manager)).toThrow(/out of range/);
    });

    it('drops the event entry when the last handler is removed', () => {
        const cwd = createTempDir();
        const configPath = path.join(cwd, '.xqoder', 'config.json');
        writeConfig(configPath, {
            hooks: {
                SessionEnd: [{ hooks: [{ type: 'command', command: 'echo one' }] }],
            },
        });
        const manager = new ConfigManager({ configPath });
        runRemoveHookCommand({ event: 'SessionEnd', index: 0 }, {}, manager);
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { hooks?: HooksSettings };
        expect(parsed.hooks?.SessionEnd).toBeUndefined();
    });
});

describe('runTestHookCommand (P14c)', () => {
    it('executes a SessionStart command hook and reports blocked=true when the hook denies', async () => {
        const cwd = createTempDir();
        const configPath = path.join(cwd, '.xqoder', 'config.json');
        writeConfig(configPath, {
            hooks: {
                SessionStart: [
                    {
                        hooks: [
                            {
                                type: 'command',
                                command: `cat >/dev/null; printf '%s' '${JSON.stringify({ decision: 'block', reason: 'gate closed' })}'`,
                            },
                        ],
                    },
                ],
            },
        });
        const manager = new ConfigManager({ configPath });
        const result = await runTestHookCommand(
            { event: 'SessionStart', dir: cwd },
            {},
            manager,
        );
        expect(result.event).toBe('SessionStart');
        expect(result.executedHandlers).toBe(1);
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('gate closed');
    });

    it('executes a PreToolUse hook and respects the matcher', async () => {
        const cwd = createTempDir();
        const configPath = path.join(cwd, '.xqoder', 'config.json');
        writeConfig(configPath, {
            hooks: {
                PreToolUse: [
                    {
                        matcher: 'read_file',
                        hooks: [
                            {
                                type: 'command',
                                command: `cat >/dev/null; printf '%s' '${JSON.stringify({
                                    hookSpecificOutput: {
                                        hookEventName: 'PreToolUse',
                                        permissionDecision: 'deny',
                                        permissionDecisionReason: 'no read',
                                    },
                                })}'`,
                            },
                        ],
                    },
                ],
            },
        });
        const manager = new ConfigManager({ configPath });
        const result = await runTestHookCommand(
            { event: 'PreToolUse', toolName: 'read_file', dir: cwd },
            {},
            manager,
        );
        expect(result.executedHandlers).toBe(1);
        expect(result.blocked).toBe(true);
    });

    it('errors on unsupported JSON payload overrides', async () => {
        const cwd = createTempDir();
        const configPath = path.join(cwd, '.xqoder', 'config.json');
        writeConfig(configPath, {});
        const manager = new ConfigManager({ configPath });
        await expect(runTestHookCommand(
            { event: 'SessionStart', dir: cwd, payloadJson: 'not json' },
            {},
            manager,
        )).rejects.toThrow(/valid JSON object/);
    });
});
