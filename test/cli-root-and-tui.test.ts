import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
    canLaunchInteractiveTui,
    resolveRootShellOutputFormat,
    runRootShellAction,
} from '../src/cli/root-shell.js';
import {
    createTuiInterfaceCommand,
    runTuiInterface,
} from '../src/interfaces/tui/index.js';

const descriptorRestorers: Array<() => void> = [];

afterEach(() => {
    while (descriptorRestorers.length > 0) {
        descriptorRestorers.pop()?.();
    }
});

describe('root shell helpers', () => {
    it('runs the non-interactive prompt path with resolved options', async () => {
        const promptRunner = spyOn({ run: async () => {} }, 'run');

        const result = await runRootShellAction({
            prompt: 'hello',
            cwd: '/tmp/demo',
            outputFormat: 'json',
            quiet: true,
            model: 'gpt-4.1',
            agent: 'coder',
        }, {
            promptRunner: promptRunner,
        });

        expect(result).toBe('handled');
        expect(promptRunner).toHaveBeenCalledWith({
            prompt: 'hello',
            cwd: '/tmp/demo',
            outputFormat: 'json',
            quiet: true,
            model: 'gpt-4.1',
            agent: 'coder',
        });
    });

    it('returns show-help when no prompt is provided and interactive tui is unavailable', async () => {
        setProperty(process.stdin, 'isTTY', false);
        setProperty(process.stdout, 'isTTY', false);

        const result = await runRootShellAction({});

        expect(result).toBe('show-help');
    });

    it('detects interactive tui capability and validates output format parsing', () => {
        setProperty(process.stdin, 'isTTY', true);
        setProperty(process.stdout, 'isTTY', true);
        setProperty(process.stdin as NodeJS.ReadStream, 'setRawMode', (() => {}) as typeof process.stdin.setRawMode);

        expect(canLaunchInteractiveTui()).toBe(true);
        expect(resolveRootShellOutputFormat('text', false)).toBe('text');
        expect(resolveRootShellOutputFormat('json', false)).toBe('json');
        expect(() => resolveRootShellOutputFormat('xml', false)).toThrow('invalid format option: xml');
    });
});

describe('tui interface helpers', () => {
    it('passes resolved settings and streams into the terminal app runtime', async () => {
        const calls: Array<{
            options: Record<string, unknown>;
            stdin: NodeJS.ReadStream;
            stdout: NodeJS.WriteStream;
            stderr: NodeJS.WriteStream;
        }> = [];
        const stdin = createTTYStdin();
        const stdout = createTTYStdout();
        const stderr = createTTYStdout();

        await runTuiInterface({
            continue: true,
            model: 'gpt-4.1',
        }, {
            stdin,
            stdout,
            stderr,
            resolveInitialSettings: () => ({
                dir: '/workspace/demo',
                model: 'gpt-4.1',
                agent: 'general',
                sandboxMode: 'project',
                initialSessionId: 'latest',
            }),
            runTerminalApp: async (options, streams) => {
                calls.push({
                    options: options as Record<string, unknown>,
                    stdin: streams.stdin!,
                    stdout: streams.stdout!,
                    stderr: streams.stderr!,
                });
            },
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]?.options).toMatchObject({
            dir: '/workspace/demo',
            model: 'gpt-4.1',
            agent: 'general',
            sandboxMode: 'project',
            initialSessionId: 'latest',
        });
        expect(calls[0]?.stdin).toBe(stdin);
        expect(calls[0]?.stdout).toBe(stdout);
        expect(calls[0]?.stderr).toBe(stderr);
    });

    it('forwards commander options into the injected tui runner', async () => {
        let received: Record<string, unknown> | null = null;
        const command = createTuiInterfaceCommand({
            runTuiCommand: async (options) => {
                received = options as Record<string, unknown>;
            },
        });

        await command.parseAsync([
            'node',
            'test',
            '--continue',
            '--session',
            'session-1',
            '--prompt',
            'hello',
            '--agent',
            'coder',
            '--model',
            'gpt-4.1',
        ]);

        expect(received).toMatchObject({
            continue: true,
            session: 'session-1',
            prompt: 'hello',
            agent: 'coder',
            model: 'gpt-4.1',
        });
    });
});

function createTTYStdin(): NodeJS.ReadStream {
    return {
        isTTY: true,
        setRawMode() {},
        on() { return this; },
        resume() { return this; },
    } as unknown as NodeJS.ReadStream;
}

function createTTYStdout(): NodeJS.WriteStream {
    return {
        isTTY: true,
        on() { return this; },
        write() { return true; },
    } as unknown as NodeJS.WriteStream;
}

function setProperty<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, {
        configurable: true,
        value,
    });
    descriptorRestorers.push(() => {
        if (previous) {
            Object.defineProperty(target, key, previous);
            return;
        }
        delete (target as Record<string, unknown>)[key as string];
    });
}
