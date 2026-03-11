// ============================================================
// XQoder 统一日志系统
// ============================================================

/** 日志级别 */
export enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    Silent = 4,
}

/** 日志级别对应图标和颜色控制码 */
const LOG_STYLES: Record<string, { icon: string; color: string; reset: string }> = {
    debug: { icon: '🔍', color: '\x1b[90m', reset: '\x1b[0m' },   // gray
    info: { icon: 'ℹ️ ', color: '\x1b[36m', reset: '\x1b[0m' },   // cyan
    warn: { icon: '⚠️ ', color: '\x1b[33m', reset: '\x1b[0m' },   // yellow
    error: { icon: '❌', color: '\x1b[31m', reset: '\x1b[0m' },    // red
    success: { icon: '✅', color: '\x1b[32m', reset: '\x1b[0m' },  // green
};

/** Logger 类 */
export class Logger {
    private level: LogLevel;
    private prefix: string;

    constructor(prefix: string = 'XQoder', level: LogLevel = LogLevel.Info) {
        this.prefix = prefix;
        this.level = level;
    }

    /** 设置日志级别 */
    setLevel(level: LogLevel): void {
        this.level = level;
    }

    /** 创建子 Logger（带前缀） */
    child(subPrefix: string): Logger {
        return new Logger(`${this.prefix}:${subPrefix}`, this.level);
    }

    /** Debug 日志 */
    debug(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.Debug) {
            this.log('debug', message, args);
        }
    }

    /** Info 日志 */
    info(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.Info) {
            this.log('info', message, args);
        }
    }

    /** Warn 日志 */
    warn(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.Warn) {
            this.log('warn', message, args);
        }
    }

    /** Error 日志 */
    error(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.Error) {
            this.log('error', message, args);
        }
    }

    /** Success 日志 */
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

/** 全局默认 Logger 实例 */
export const logger = new Logger();
