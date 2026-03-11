import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { runTuiCommand } from './tui.js';

function createMockStream() {
    const stream = new EventEmitter() as EventEmitter & {
        isTTY: boolean;
        writable: boolean;
        setRawMode: ReturnType<typeof vi.fn>;
        resume: ReturnType<typeof vi.fn>;
    };
    stream.isTTY = true;
    stream.writable = true;
    stream.setRawMode = vi.fn();
    stream.resume = vi.fn();
    return stream;
}

describe('runTuiCommand supervisor', () => {
    it('restarts the TUI when Ink exits unexpectedly', async () => {
        const renderApp = vi.fn()
            .mockReturnValueOnce({ waitUntilExit: vi.fn().mockResolvedValue(undefined) })
            .mockReturnValueOnce({ waitUntilExit: vi.fn().mockResolvedValue(undefined) });
        const stderrWrite = vi.fn();

        await runTuiCommand(
            { dir: '/tmp/project', legacyInk: true },
            {
                renderApp,
                installPanicHandler: vi.fn(),
                installSafeTtyGuards: () => () => {},
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
                    off: vi.fn(),
                } as never,
                stdout: {
                    isTTY: false,
                    writable: true,
                    on: vi.fn(),
                    write: vi.fn(),
                } as never,
                stderr: {
                    writable: true,
                    on: vi.fn(),
                    write: stderrWrite,
                } as never,
                wait: vi.fn().mockResolvedValue(undefined),
                maxUnexpectedRestarts: 1,
            },
        );

        expect(renderApp).toHaveBeenCalledTimes(2);
        expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('restarting'));
    });

    it('does not restart after an explicit exit request', async () => {
        const renderApp = vi.fn().mockImplementation((element: { props?: { onRequestExit?: () => void } }) => {
            element.props?.onRequestExit?.();
            return { waitUntilExit: vi.fn().mockResolvedValue(undefined) };
        });

        await runTuiCommand(
            { dir: '/tmp/project', legacyInk: true },
            {
                renderApp,
                installPanicHandler: vi.fn(),
                installSafeTtyGuards: () => () => {},
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
                    off: vi.fn(),
                } as never,
                stdout: {
                    isTTY: false,
                    writable: true,
                    on: vi.fn(),
                    write: vi.fn(),
                } as never,
                stderr: {
                    writable: true,
                    on: vi.fn(),
                    write: vi.fn(),
                } as never,
                wait: vi.fn().mockResolvedValue(undefined),
                maxUnexpectedRestarts: 2,
            },
        );

        expect(renderApp).toHaveBeenCalledTimes(1);
    });

    it('exits safely on tty lifecycle disconnect without restart loop', async () => {
        const stdin = createMockStream();
        const stdout = createMockStream();
        const stderr = createMockStream();
        const stderrWrite = vi.fn();
        (stderr as unknown as { write: (...args: unknown[]) => void }).write = stderrWrite;

        const renderApp = vi.fn().mockReturnValue({
            waitUntilExit: vi.fn().mockImplementation(async () => {
                stdin.emit('close');
            }),
            unmount: vi.fn(),
        });

        await runTuiCommand(
            { dir: '/tmp/project', legacyInk: true },
            {
                renderApp,
                installPanicHandler: vi.fn(),
                installSafeTtyGuards: () => () => {},
                installSafeRuntimeGuards: () => () => {},
                resolveInitialSettings: () => ({
                    dir: '/tmp/project',
                    model: 'qwen-plus',
                    agent: 'general',
                    sandboxMode: 'project',
                }),
                stdin: stdin as never,
                stdout: stdout as never,
                stderr: stderr as never,
                wait: vi.fn().mockResolvedValue(undefined),
                maxUnexpectedRestarts: 2,
            },
        );

        expect(renderApp).toHaveBeenCalledTimes(1);
        expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('TTY lifecycle event'));
        expect(stderrWrite).not.toHaveBeenCalledWith(expect.stringContaining('restarting'));
    });

    it('TUI 启动失败：renderApp 抛错时 stderr 输出 [XQoder] Failed to start TUI:', async () => {
        const stderrWrite = vi.fn();
        const renderApp = vi.fn().mockImplementation(() => {
            throw new Error('Ink render failed');
        });

        await runTuiCommand(
            { dir: '/tmp/project', legacyInk: true },
            {
                renderApp,
                installPanicHandler: vi.fn(),
                installSafeTtyGuards: () => () => {},
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
                    off: vi.fn(),
                } as never,
                stdout: { isTTY: false, writable: true, on: vi.fn(), write: vi.fn() } as never,
                stderr: { writable: true, on: vi.fn(), write: stderrWrite } as never,
                wait: vi.fn().mockResolvedValue(undefined),
                maxUnexpectedRestarts: 1,
            },
        );

        expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[XQoder] Failed to start TUI:'));
        expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Ink render failed'));
    });

    it('launches the new terminal-core path by default', async () => {
        const runTerminalApp = vi.fn().mockResolvedValue(undefined);

        await runTuiCommand(
            { dir: '/tmp/project' },
            {
                runTerminalApp,
                installPanicHandler: vi.fn(),
                installSafeTtyGuards: () => () => {},
                installSafeRuntimeGuards: () => () => {},
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
                    off: vi.fn(),
                } as never,
                stdout: { isTTY: true, writable: true, on: vi.fn(), off: vi.fn(), write: vi.fn(), columns: 120, rows: 40 } as never,
                stderr: { writable: true, on: vi.fn(), write: vi.fn() } as never,
            },
        );

        expect(runTerminalApp).toHaveBeenCalledWith(expect.objectContaining({ dir: '/tmp/project' }), expect.any(Object));
    });

    it('uses the legacy Ink renderer when explicitly requested', async () => {
        const runTerminalApp = vi.fn().mockResolvedValue(undefined);
        const renderApp = vi.fn().mockImplementation((element: { props?: { onRequestExit?: () => void } }) => {
            element.props?.onRequestExit?.();
            return { waitUntilExit: vi.fn().mockResolvedValue(undefined) };
        });

        await runTuiCommand(
            { dir: '/tmp/project', legacyInk: true },
            {
                runTerminalApp,
                renderApp,
                installPanicHandler: vi.fn(),
                installSafeTtyGuards: () => () => {},
                installSafeRuntimeGuards: () => () => {},
                resolveInitialSettings: () => ({
                    dir: '/tmp/project',
                    model: 'qwen-plus',
                    agent: 'general',
                    sandboxMode: 'project',
                    legacyInk: true,
                }),
                stdin: {
                    isTTY: true,
                    setRawMode: vi.fn(),
                    resume: vi.fn(),
                    on: vi.fn(),
                    off: vi.fn(),
                } as never,
                stdout: { isTTY: true, writable: true, on: vi.fn(), off: vi.fn(), write: vi.fn(), columns: 120, rows: 40 } as never,
                stderr: { writable: true, on: vi.fn(), write: vi.fn() } as never,
            },
        );

        expect(runTerminalApp).not.toHaveBeenCalled();
        expect(renderApp).toHaveBeenCalledTimes(1);
    });
});
