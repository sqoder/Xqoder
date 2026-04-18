// ============================================================
// XQoder Unified Logging System
// ============================================================

/** Log Level */
export enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    Silent = 4,
}

/** Log level mapping for icons and color control codes */
const LOG_STYLES: Record<string, { icon: string; color: string; reset: string }> = {
    debug: { icon: '🔍', color: '\x1b[90m', reset: '\x1b[0m' },   // gray
    info: { icon: 'ℹ️ ', color: '\x1b[36m', reset: '\x1b[0m' },   // cyan
    warn: { icon: '⚠️ ', color: '\x1b[33m', reset: '\x1b[0m' },   // yellow
    error: { icon: '❌', color: '\x1b[31m', reset: '\x1b[0m' },    // red
    success: { icon: '✅', color: '\x1b[32m', reset: '\x1b[0m' },  // green
};

/** Logger Class */
export class Logger {
    private level: LogLevel;
    private prefix: string;

    constructor(prefix: string = 'XQoder', level: LogLevel = LogLevel.Info) {
        this.prefix = prefix;
        this.level = level;
    }

    /** Set log level */
    setLevel(level: LogLevel): void {
        this.level = level;
    }

    /** Create child Logger (with prefix) */
    child(subPrefix: string): Logger {
        return new Logger(`${this.prefix}:${subPrefix}`, this.level);
    }

    /** Debug log */
    debug(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.Debug) {
            this.log('debug', message, args);
        }
    }

    /** Info log */
    info(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.Info) {
            this.log('info', message, args);
        }
    }

    /** Warn log */
    warn(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.Warn) {
            this.log('warn', message, args);
        }
    }

    /** Error log */
    error(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.Error) {
            this.log('error', message, args);
        }
    }

    /** Success log */
    success(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.Info) {
            this.log('success', message, args);
        }
    }

    private log(type: string, message: string, args: unknown[]): void {
        const style = LOG_STYLES[type] ?? LOG_STYLES['info']!;
        const timestamp = new Date().toISOString().slice(11, 19);
        const formatted = `${style.color}${style.icon} [${timestamp}] [${this.prefix}] ${message}${style.reset}`;

        if (type === 'error') {
            console.error(formatted, ...args);
        } else if (type === 'warn') {
            console.warn(formatted, ...args);
        } else {
            console.log(formatted, ...args);
        }
    }
}

/** Global default Logger instance */
export const logger = new Logger();
