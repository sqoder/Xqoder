import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
    canLaunchInteractiveTui,
    resolveRootShellOutputFormat,
    runRootShellAction,
} from '../src/cli/root-shell.js';
import { XQoderAgent } from '../src/core/agent/agent.js';
import {
    createMvpTypeErrorDemoProvider,
    createMvpTypeErrorDemoWorkspace,
    MVP_TYPEERROR_DEMO_PROMPT,
} from '../src/core/agent/mvp/demo.js';
import { FileRollbackStore } from '../src/core/agent/tools/rollback-store.js';
import {
    createTuiInterfaceCommand,
    runTuiInterface,
} from '../src/interfaces/tui/index.js';

const descriptorRestorers: Array<() => void> = [];
const tempDirs: string[] = [];

afterEach(() => {
    while (descriptorRestorers.length > 0) {
        descriptorRestorers.pop()?.();
    }

    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
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
            resume: 'session-7',
            continue: true,
            forkSession: true,
            permissionMode: 'allow',
            approvalPolicy: 'workspace_auto',
            effort: 'high',
            maxTurns: 3,
            noSessionPersistence: true,
            allowedTools: 'read_file, write_file',
            disallowedTools: 'bash',
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
            resume: 'session-7',
            continue: true,
            forkSession: true,
            permissionMode: 'allow',
            approvalPolicy: 'workspace_auto',
            effort: 'high',
            maxTurns: 3,
            noSessionPersistence: true,
            allowedTools: ['read_file', 'write_file'],
            disallowedTools: ['bash'],
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

    it('drives the TypeError demo through the root shell non-interactive CLI path', async () => {
        const cwd = createMvpTypeErrorDemoWorkspace();
        tempDirs.push(cwd);
        const stdout = captureStream(process.stdout, 'write');
        const savedCalls: Array<Record<string, unknown>> = [];

        const result = await runRootShellAction({
            prompt: MVP_TYPEERROR_DEMO_PROMPT,
            cwd,
            outputFormat: 'text',
            quiet: true,
        }, {
            chatDependencies: {
                configManager: { load: () => createLoadedConfig('test-key') },
                sessionStore: {
                    findLatestSession: () => null,
                    getSession: () => null,
                    saveSession: (input: Record<string, unknown>) => {
                        savedCalls.push(input);
                        return { id: 'root-shell-demo-summary' };
                    },
                },
                agentFactory: (config) => {
                    const provider = createMvpTypeErrorDemoProvider();
                    return new XQoderAgent({
                        ...(config as unknown as ConstructorParameters<typeof XQoderAgent>[0]),
                        rollbackStore: new FileRollbackStore(path.join(cwd, '.rollbacks')),
                        providerFactory: async () => provider,
                        permissions: {
                            defaultMode: 'allow',
                            tools: {},
                        },
                    });
                },
            },
        });

        expect(result).toBe('handled');
        expect(savedCalls).toHaveLength(1);
        expect(stdout.value).toContain('修复完成：src/utils.ts 已补上 guard clause');
        expect(fs.readFileSync(path.join(cwd, 'src/utils.ts'), 'utf-8')).toContain("return 'UNKNOWN';");
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

function createLoadedConfig(apiKey: string) {
    return {
        llm: {
            provider: 'openai',
            model: 'gpt-4.1',
            apiKey,
        },
        providers: {
            openai: {
                apiKey,
                defaultModel: 'gpt-4.1',
            },
        },
        contextPaths: ['xqoder.md'],
        defaultAgent: 'general',
        agents: {
            general: {
                mode: 'primary',
                provider: 'openai',
                model: 'gpt-4.1',
            },
        },
        sandbox: {
            mode: 'project',
            allowedPaths: [],
        },
    };
}

function captureStream<
    T extends { [K in P]: (...args: any[]) => unknown },
    P extends keyof T,
>(target: T, property: P): { value: string } {
    const previous = Object.getOwnPropertyDescriptor(target, property);
    const captured = { value: '' };

    Object.defineProperty(target, property, {
        configurable: true,
        value: (...args: unknown[]) => {
            captured.value += String(args[0] ?? '');
            return true;
        },
    });

    descriptorRestorers.push(() => {
        if (previous) {
            Object.defineProperty(target, property, previous);
            return;
        }
        delete (target as Record<string, unknown>)[property as string];
    });

    return captured;
}
