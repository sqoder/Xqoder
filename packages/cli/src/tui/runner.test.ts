import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCliCommand } from './runner.js';

const { spawnMock } = vi.hoisted(() => ({
    spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
    spawn: spawnMock,
}));

class MockChildProcess extends EventEmitter {
    stdout = new PassThrough();
    stderr = new PassThrough();
    killed = false;

    kill(signal?: NodeJS.Signals): boolean {
        this.killed = true;
        this.emit('exit', null, signal ?? 'SIGINT');
        return true;
    }
}

describe('runCliCommand', () => {
    afterEach(() => {
        spawnMock.mockReset();
    });

    it('spawns the CLI with the exact args built by the TUI, including session restore flags', () => {
        const child = new MockChildProcess();
        spawnMock.mockReturnValue(child);

        runCliCommand([
            'chat',
            '继续，重复当前会话里的标记。',
            '--dir',
            '/tmp/xqoder-tui-smoke',
            '--model',
            'qwen-plus',
            '--agent',
            'general',
            '--session',
            'session_A123',
        ], {
            dir: '/tmp/xqoder-tui-smoke',
            model: 'qwen-plus',
            agent: 'general',
            sandboxMode: 'project',
        }, {
            onLine: vi.fn(),
            onExit: vi.fn(),
        });

        expect(spawnMock).toHaveBeenCalledWith(
            process.execPath,
            expect.arrayContaining([
                'chat',
                '继续，重复当前会话里的标记。',
                '--session',
                'session_A123',
            ]),
            expect.objectContaining({
                cwd: '/tmp/xqoder-tui-smoke',
            }),
        );
    });
});
