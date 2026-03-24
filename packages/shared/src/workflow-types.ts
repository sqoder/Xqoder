import type { ProjectConfig } from './project-types.js';

// ---- Workflow 相关类型 ----

/** 工作流状态 */
export enum WorkflowStatus {
    Pending = 'pending',
    Running = 'running',
    Paused = 'paused',
    Completed = 'completed',
    Failed = 'failed',
}

/** 工作流步骤状态 */
export enum StepStatus {
    Pending = 'pending',
    Running = 'running',
    Completed = 'completed',
    Failed = 'failed',
    Skipped = 'skipped',
    RolledBack = 'rolled_back',
}

/** 工作流步骤结果 */
export interface StepResult {
    stepName: string;
    status: StepStatus;
    output?: string;
    error?: string;
    startedAt: Date;
    completedAt?: Date;
}

/** 工作流执行上下文 */
export interface WorkflowContext {
    /** 项目配置 */
    projectConfig: ProjectConfig;
    /** 用户原始请求 */
    userRequest: string;
    /** 各步骤结果 */
    stepResults: StepResult[];
    /** 共享数据（步骤间传递） */
    data: Record<string, unknown>;
}
