// ============================================================
// 工作流步骤抽象
// ============================================================

import type { StepResult, StepStatus, WorkflowContext } from '@xqoder/shared';

/**
 * WorkflowStep 接口
 * 每个工作流步骤都必须实现此接口
 */
export interface IWorkflowStep {
    /** 步骤名称 */
    readonly name: string;
    /** 步骤描述 */
    readonly description: string;

    /**
     * 执行步骤
     * @returns 步骤执行结果
     */
    execute(context: WorkflowContext): Promise<StepResult>;

    /**
     * 验证步骤执行结果
     * @returns 是否验证通过
     */
    validate(context: WorkflowContext): Promise<boolean>;

    /**
     * 回滚步骤（可选）
     * 当后续步骤失败时调用
     */
    rollback?(context: WorkflowContext): Promise<void>;
}

/**
 * BaseStep 基类
 * 提供通用的步骤辅助方法
 */
export abstract class BaseStep implements IWorkflowStep {
    abstract readonly name: string;
    abstract readonly description: string;

    abstract execute(context: WorkflowContext): Promise<StepResult>;

    async validate(_context: WorkflowContext): Promise<boolean> {
        // 默认验证：检查最近的步骤结果是否成功
        const lastResult = _context.stepResults[_context.stepResults.length - 1];
        return lastResult?.status === ('completed' as StepStatus);
    }

    /** 创建成功结果 */
    protected success(output?: string): StepResult {
        return {
            stepName: this.name,
            status: 'completed' as StepStatus,
            output,
            startedAt: new Date(),
            completedAt: new Date(),
        };
    }

    /** 创建失败结果 */
    protected failure(error: string): StepResult {
        return {
            stepName: this.name,
            status: 'failed' as StepStatus,
            error,
            startedAt: new Date(),
            completedAt: new Date(),
        };
    }
}
