import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { LogLevel, logger } from '@xqoder/shared';
import { rustTui } from '../terminal-core/rust-tui.js';

export function withRawMode<T>(stdin: NodeJS.ReadStream, run: () => Promise<T>): Promise<T> {
    const originalRawMode = stdin.isRaw;
    try { stdin.setRawMode?.(true); } catch { /* ignore */ }
    return run().finally(() => {
        try { stdin.setRawMode?.(Boolean(originalRawMode)); } catch { /* ignore */ }
    });
}

export function enterTerminal(stdout: NodeJS.WriteStream): void {
    rustTui.enterTerminalMode(stdout);
}

export function leaveTerminal(stdout: NodeJS.WriteStream): void {
    rustTui.leaveTerminalMode(stdout);
}

export function resolveExternalEditor(): string {
    return process.env.EDITOR
        ?? process.env.VISUAL
        ?? (process.platform === 'win32' ? 'notepad' : 'nano');
}

export function buildExternalEditorHint(editorCommand: string): string {
    const lower = editorCommand.trim().toLowerCase();
    if (lower.includes('nano')) {
        return `Opening external editor: ${editorCommand} (save: Ctrl+O then Enter, exit: Ctrl+X)`;
    }
    if (lower.includes('vim') || lower.includes('vi')) {
        return `Opening external editor: ${editorCommand} (insert: i, save+quit: Esc then :wq Enter, quit: Esc then :q! Enter)`;
    }
    if (lower.includes('code')) {
        return `Opening external editor: ${editorCommand} (save in editor, then close window to return)`;
    }
    if (lower.includes('zed')) {
        return `Opening external editor: ${editorCommand} (save in editor, then close window to return)`;
    }
    return `Opening external editor: ${editorCommand}`;
}

export function openInExternalEditor(initialValue: string, stdout: NodeJS.WriteStream): { value?: string; error?: string } {
    const editor = resolveExternalEditor();
    const tempFilePath = path.join(os.tmpdir(), `xqoder-terminal-editor-${Date.now()}.md`);

    try {
        fs.writeFileSync(tempFilePath, initialValue, 'utf8');
        leaveTerminal(stdout);
        const result = spawnSync(editor, [tempFilePath], {
            stdio: 'inherit',
            env: process.env,
        });
        enterTerminal(stdout);

        if (result.error) {
            return { error: result.error.message };
        }
        if (result.status !== 0) {
            return { error: `Editor exited with code ${String(result.status)}` };
        }

        return { value: fs.readFileSync(tempFilePath, 'utf8') };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    } finally {
        try {
            fs.unlinkSync(tempFilePath);
        } catch {
            // ignore cleanup failure
        }
    }
}

export function installTerminalNoiseGuards(): () => void {
    const originalEmitWarning = process.emitWarning.bind(process);
    const originalConsole = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
    };

    logger.setLevel(LogLevel.Silent);
    process.emitWarning = (() => undefined) as typeof process.emitWarning;
    console.log = (() => undefined) as typeof console.log;
    console.info = (() => undefined) as typeof console.info;
    console.warn = (() => undefined) as typeof console.warn;
    console.error = (() => undefined) as typeof console.error;

    return () => {
        process.emitWarning = originalEmitWarning;
        console.log = originalConsole.log;
        console.info = originalConsole.info;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
        logger.setLevel(LogLevel.Info);
    };
}
