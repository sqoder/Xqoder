// ============================================================
// Panic Recovery — Uncaught exceptions/Promise Rejections recovery
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getXQoderPaths } from './paths.js';

export interface PanicLogEntry {
    timestamp: string;
    name: string;
    error: string;
    stack?: string;
}

function writePanicLog(name: string, error: unknown): string {
    const paths = getXQoderPaths();
    const logDir = path.join(paths.dataDir, 'panic-logs');
    try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }

    const entry: PanicLogEntry = {
        timestamp: new Date().toISOString(),
        name,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
    };

    const filename = `xqoder-panic-${name}-${Date.now()}.log`;
    const filepath = path.join(logDir, filename);

    try {
        fs.writeFileSync(filepath, JSON.stringify(entry, null, 2), 'utf-8');
    } catch { /* ignore */ }

    return filepath;
}

/**
 * Safely attempt to write to stderr. Returns false on failure.
 * This prevents cascading EIO errors when stderr is broken (e.g. in pnpm shell).
 */
function safeStderrWrite(msg: string): boolean {
    try {
        if (process.stderr.writable) {
            process.stderr.write(msg);
            return true;
        }
    } catch {
        // EIO, EPIPE, or other write errors — swallow silently
    }
    return false;
}

/** Guard against re-entrant uncaughtException handlers */
let handlingException = false;

/**
 * Install global handlers for uncaught exceptions and unhandled rejections.
 * Logs panic info to disk. In TUI mode (exitOnPanic=false), the process
 * is NOT killed — Ink/React must remain alive. In CLI mode the process exits.
 */
export function installPanicHandler(options: {
    name?: string;
    cleanup?: () => void | Promise<void>;
    exitOnPanic?: boolean;
} = {}): void {
    const { name = 'main', cleanup, exitOnPanic = true } = options;

    process.on('uncaughtException', async (error) => {
        // Prevent recursive handler invocation (e.g. stderr.write EIO)
        if (handlingException) return;
        handlingException = true;

        try {
            const logPath = writePanicLog(name, error);
            safeStderrWrite(`\n[XQoder] Uncaught exception — log: ${logPath}\n`);
            safeStderrWrite(`  ${error instanceof Error ? error.message : String(error)}\n`);
        } catch {
            // Last-resort: even writePanicLog or safeStderrWrite threw — give up
        }

        if (exitOnPanic) {
            try { await cleanup?.(); } catch { /* ignore */ }
            process.exit(1);
        }

        handlingException = false;
    });

    process.on('unhandledRejection', (reason) => {
        try {
            writePanicLog(`${name}-promise`, reason);
        } catch {
            // Filesystem might also be unavailable — swallow
        }
    });
}
