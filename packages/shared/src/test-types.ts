import type { PackageManager } from './project-types.js';

// ---- Test 相关类型 ----

/** 测试状态 */
export enum TestStatus {
    Pending = 'pending',
    Running = 'running',
    Passed = 'passed',
    Failed = 'failed',
    Skipped = 'skipped',
}

/** 标准化测试失败信息 */
export interface TestFailure {
    message: string;
    testName?: string;
    file?: string;
}

/** 标准化测试报告 */
export interface TestReport {
    status: TestStatus;
    /** 项目目录 */
    projectDir: string;
    /** 包管理器 */
    packageManager?: PackageManager;
    /** 实际执行命令 */
    command?: string;
    /** 标准输出与标准错误合并后的结果 */
    output: string;
    /** 通过数量 */
    passed: number;
    /** 失败数量 */
    failed: number;
    /** 跳过数量 */
    skipped: number;
    /** 结构化失败摘要 */
    failures: TestFailure[];
    /** 开始时间 */
    startedAt: Date;
    /** 完成时间 */
    completedAt?: Date;
}
