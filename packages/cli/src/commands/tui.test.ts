import { describe, expect, it, vi } from 'vitest';
import { runTuiCommand } from './tui.js';

describe('runTuiCommand terminal-core only', () => {
    it('launches terminal-core by default', async () => {
        const runTerminalAppMock = vi.fn().mockResolvedValue(undefined);

        await runTuiCommand(
            { dir: '/tmp/project' },
            {
                runTerminalApp: runTerminalAppMock,
                installPanicHandler: vi.fn(),
                resolveInitialSettings: () => ({
                    dir: '/tmp/project',
                    model: 'qwen-plus',
                    agent: 'general',
                    sandboxMode: 'project',
                }),
                stdin: {
                    isTTY: true,
                    setRawMode: vi.fn(),
                    resume: vi.fn(),
                    on: vi.fn(),
                } as never,
                stdout: {
                    isTTY: true,
                    writable: true,
                    on: vi.fn(),
                } as never,
                stderr: {
                    writable: true,
                    on: vi.fn(),
                    write: vi.fn(),
                } as never,
            },
        );

        expect(runTerminalAppMock).toHaveBeenCalledWith(
            expect.objectContaining({ dir: '/tmp/project' }),
            expect.any(Object),
        );
    });

    it('returns early when stdin is not interactive TTY', async () => {
        const runTerminalAppMock = vi.fn().mockResolvedValue(undefined);

        await runTuiCommand(
            { dir: '/tmp/project' },
            {
                runTerminalApp: runTerminalAppMock,
                installPanicHandler: vi.fn(),
                stdin: {
                    isTTY: false,
                    setRawMode: undefined,
                    on: vi.fn(),
                } as never,
                stdout: {
                    isTTY: false,
                    writable: true,
                    on: vi.fn(),
                } as never,
                stderr: {
                    writable: true,
                    on: vi.fn(),
                    write: vi.fn(),
                } as never,
            },
        );

        expect(runTerminalAppMock).not.toHaveBeenCalled();
    });
});
