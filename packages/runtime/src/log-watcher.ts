// ============================================================
// 日志监控器
// ============================================================

import { EventEmitter } from 'node:events';
import type { RuntimeError, RuntimeErrorType } from '@xqoder/shared';

/** 日志条目 */
export interface LogEntry {
    timestamp: Date;
    stream: 'stdout' | 'stderr';
    content: string;
    /** 是否包含错误 */
    isError: boolean;
}

/** LogWatcher 事件 */
export interface LogWatcherEvents {
    log: (entry: LogEntry) => void;
    error: (error: RuntimeError) => void;
    ready: (url: string) => void;
}

/**
 * LogWatcher
 * 实时监控进程输出，识别错误模式和就绪状态
 */
export class LogWatcher extends EventEmitter {
    private logs: LogEntry[] = [];
    private readonly maxLogs: number;

    /** 就绪检测模式 — 检测 dev server 启动成功 */
    private readonly readyPatterns = [
        /Local:\s+(https?:\/\/\S+)/i,
        /listening\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
        /started\s+(?:server\s+)?(?:on\s+)?(?:port\s+)?(?:at\s+)?(https?:\/\/\S+)/i,
        /ready\s+(?:on|at|in)\s+(https?:\/\/\S+)/i,
        /http:\/\/localhost:(\d+)/,
        /http:\/\/127\.0\.0\.1:(\d+)/,
    ];

    /** 错误检测模式 */
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
     * 处理一行日志
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

        // 检查就绪模式
        this.checkReady(line);

        // 检查错误模式
        if (entry.isError) {
            this.checkError(line);
        }
    }

    /** 获取最近的日志 */
    getRecentLogs(count: number = 50): LogEntry[] {
        return this.logs.slice(-count);
    }

    /** 获取所有错误日志 */
    getErrorLogs(): LogEntry[] {
        return this.logs.filter(l => l.isError);
    }

    /** 清空日志 */
    clear(): void {
        this.logs = [];
    }

    /** 检查是否包含错误关键词 */
    private containsError(line: string): boolean {
        return this.errorPatterns.some(({ pattern }) => pattern.test(line));
    }

    /** 检查就绪状态 */
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

    /** 检查并发出错误事件 */
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

    /** 根据错误类型获取建议 */
    private getSuggestion(type: RuntimeErrorType, detail?: string): string {
        switch (type) {
            case 'dependency_missing':
                return detail ? `尝试运行: npm install ${detail}` : '检查并安装缺失的依赖';
            case 'compile_error':
                return '检查代码语法错误';
            case 'port_conflict':
                return '端口已被占用，尝试使用其他端口';
            case 'permission_denied':
                return '权限不足，尝试使用 sudo 或检查文件权限';
            case 'config_error':
                return detail ? `检查项目配置，确认 ${detail} 对应的脚本或文件存在` : '检查项目配置和启动脚本';
            default:
                return '查看完整错误日志进行排查';
        }
    }
}
