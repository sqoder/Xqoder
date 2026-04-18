// ============================================================
// Log Watcher
// ============================================================

import { EventEmitter } from 'node:events';
import type { RuntimeError, RuntimeErrorType } from '@xqoder/shared';

/** Log Entry */
export interface LogEntry {
    timestamp: Date;
    stream: 'stdout' | 'stderr';
    content: string;
    /** Whether it contains an error */
    isError: boolean;
}

/** LogWatcher Events */
export interface LogWatcherEvents {
    log: (entry: LogEntry) => void;
    error: (error: RuntimeError) => void;
    ready: (url: string) => void;
}

/**
 * LogWatcher
 * Monitors process output in real-time, identifying error patterns and readiness states
 */
export class LogWatcher extends EventEmitter {
    private logs: LogEntry[] = [];
    private readonly maxLogs: number;

    /** Readiness patterns — detect successful dev server startup */
    private readonly readyPatterns = [
        /Local:\s+(https?:\/\/\S+)/i,
        /listening\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
        /started\s+(?:server\s+)?(?:on\s+)?(?:port\s+)?(?:at\s+)?(https?:\/\/\S+)/i,
        /ready\s+(?:on|at|in)\s+(https?:\/\/\S+)/i,
        /http:\/\/localhost:(\d+)/,
        /http:\/\/127\.0\.0\.1:(\d+)/,
    ];

    /** Error detection patterns */
    private readonly errorPatterns: Array<{ pattern: RegExp; type: RuntimeErrorType }> = [
        { pattern: /Cannot find module '([^']+)'/i, type: 'dependency_missing' as RuntimeErrorType },
        { pattern: /Module not found.*?'([^']+)'/i, type: 'dependency_missing' as RuntimeErrorType },
        { pattern: /Error: Cannot find module/i, type: 'dependency_missing' as RuntimeErrorType },
        { pattern: /Could not resolve ['"]([^'"]+)['"]/i, type: 'dependency_missing' as RuntimeErrorType },
        { pattern: /command not found/i, type: 'dependency_missing' as RuntimeErrorType },
        { pattern: /Missing script:/i, type: 'config_error' as RuntimeErrorType },
        { pattern: /SyntaxError:/i, type: 'compile_error' as RuntimeErrorType },
        { pattern: /TypeError:/i, type: 'runtime_exception' as RuntimeErrorType },
        { pattern: /ReferenceError:/i, type: 'runtime_exception' as RuntimeErrorType },
        { pattern: /EADDRINUSE/i, type: 'port_conflict' as RuntimeErrorType },
        { pattern: /address already in use/i, type: 'port_conflict' as RuntimeErrorType },
        { pattern: /EACCES/i, type: 'permission_denied' as RuntimeErrorType },
        { pattern: /ENOENT/i, type: 'config_error' as RuntimeErrorType },
        { pattern: /Failed to compile/i, type: 'compile_error' as RuntimeErrorType },
        { pattern: /error TS\d+:/i, type: 'compile_error' as RuntimeErrorType },
    ];

    constructor(maxLogs: number = 1000) {
        super();
        this.maxLogs = maxLogs;
    }

    /**
     * Process a single log line
     */
    processLine(line: string, stream: 'stdout' | 'stderr'): void {
        const entry: LogEntry = {
            timestamp: new Date(),
            stream,
            content: line,
            isError: stream === 'stderr' || this.containsError(line),
        };

        this.logs.push(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        this.emit('log', entry);

        // Check readiness patterns
        this.checkReady(line);

        // Check error patterns
        if (entry.isError) {
            this.checkError(line);
        }
    }

    /** Get recent logs */
    getRecentLogs(count: number = 50): LogEntry[] {
        return this.logs.slice(-count);
    }

    /** Get all error logs */
    getErrorLogs(): LogEntry[] {
        return this.logs.filter(l => l.isError);
    }

    /** Clear logs */
    clear(): void {
        this.logs = [];
    }

    /** Check if line contains error keywords */
    private containsError(line: string): boolean {
        return this.errorPatterns.some(({ pattern }) => pattern.test(line));
    }

    /** Check readiness status */
    private checkReady(line: string): void {
        for (const pattern of this.readyPatterns) {
            const match = line.match(pattern);
            if (match) {
                const urlOrPort = match[1]!;
                const url = urlOrPort.startsWith('http')
                    ? urlOrPort
                    : `http://localhost:${urlOrPort}`;
                this.emit('ready', url);
                return;
            }
        }
    }

    /** Check and emit error events */
    private checkError(line: string): void {
        for (const { pattern, type } of this.errorPatterns) {
            const match = line.match(pattern);
            if (match) {
                const error: RuntimeError = {
                    type,
                    message: line.trim(),
                    suggestion: this.getSuggestion(type, match[1]),
                };
                this.emit('error', error);
                return;
            }
        }
    }

    /** Get suggestion based on error type */
    private getSuggestion(type: RuntimeErrorType, detail?: string): string {
        switch (type) {
            case 'dependency_missing':
                return detail ? `Try running: npm install ${detail}` : 'Check and install missing dependencies';
            case 'compile_error':
                return 'Check for code syntax errors';
            case 'port_conflict':
                return 'Port is already in use, try using a different port';
            case 'permission_denied':
                return 'Insufficient permissions, try using sudo or check file permissions';
            case 'config_error':
                return detail ? `Check project configuration, ensure script or file for ${detail} exists` : 'Check project configuration and startup scripts';
            default:
                return 'Check full error logs for troubleshooting';
        }
    }
}
