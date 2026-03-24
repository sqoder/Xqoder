import type { PackageManager } from './project-types.js';
import { ProjectType } from './project-types.js';

// ---- Runtime 相关类型 ----

/** Runtime 运行状态 */
export enum RuntimeStatus {
    Idle = 'idle',
    Starting = 'starting',
    Running = 'running',
    Error = 'error',
    Stopped = 'stopped',
}

/** 标准化运行报告 */
export interface RunReport {
    status: RuntimeStatus;
    /** 项目目录 */
    projectDir: string;
    /** 项目类型 */
    projectType: ProjectType;
    /** 检测到的框架 */
    framework?: string;
    /** 包管理器 */
    packageManager?: PackageManager;
    /** 实际执行命令 */
    command?: string;
    /** 实际端口 */
    port?: number;
    /** 运行地址（如 http://localhost:3000） */
    url?: string;
    /** 进程 PID */
    pid?: number;
    /** 错误信息 */
    errors: RuntimeError[];
    /** 日志输出 */
    logs: string[];
    /** 启动时间 */
    startedAt: Date;
    /** 完成时间 */
    completedAt?: Date;
}

/** Runtime 运行结果 */
export type RuntimeResult = RunReport;

/** 运行时错误 */
export interface RuntimeError {
    type: RuntimeErrorType;
    message: string;
    /** 错误源文件 */
    file?: string;
    /** 错误行号 */
    line?: number;
    /** 原始堆栈 */
    stack?: string;
    /** 建议修复方式 */
    suggestion?: string;
}

/** 运行时错误类型 */
export enum RuntimeErrorType {
    DependencyMissing = 'dependency_missing',
    CompileError = 'compile_error',
    RuntimeException = 'runtime_exception',
    PortConflict = 'port_conflict',
    PermissionDenied = 'permission_denied',
    ConfigError = 'config_error',
    Unknown = 'unknown',
}
