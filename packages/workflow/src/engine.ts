// ============================================================
// WorkflowEngine 核心类
// ============================================================

import {
    WorkflowStatus,
    StepStatus,
    type WorkflowContext,
    type StepResult,
    type ProjectConfig,
} from '@xqoder/shared';
import { WorkflowError, Logger, logger as defaultLogger } from '@xqoder/shared';
import type { IWorkflowStep } from './step.js';

/** 工作流事件回调 */
export interface WorkflowCallbacks {
    onStepStart?: (stepName: string, index: number, total: number) => void;
    onStepComplete?: (result: StepResult) => void;
    onStepFailed?: (stepName: string, error: string) => void;
    onWorkflowComplete?: (results: StepResult[]) => void;
    onWorkflowFailed?: (error: string) => void;
}

/** 工作流执行结果 */
export interface WorkflowResult {
    status: WorkflowStatus;
    stepResults: StepResult[];
    totalDuration: number;
    error?: string;
}

/**
 * WorkflowEngine
 * 负责按顺序执行工作流步骤，处理错误和回滚
 */
export class WorkflowEngine {
    private steps: IWorkflowStep[] = [];
    private status: WorkflowStatus = WorkflowStatus.Pending;
    private logger: Logger;

    constructor() {
        this.logger = defaultLogger.child('Workflow');
    }

    /**
     * 添加步骤
     */
    addStep(step: IWorkflowStep): this {
        this.steps.push(step);
        return this;
    }

    /**
     * 批量添加步骤
     */
    addSteps(steps: IWorkflowStep[]): this {
        this.steps.push(...steps);
        return this;
    }

    /**
     * 执行工作流
     */
    async execute(
        userRequest: string,
        projectConfig: ProjectConfig,
        callbacks?: WorkflowCallbacks,
    ): Promise<WorkflowResult> {
        const startTime = Date.now();
        this.status = WorkflowStatus.Running;

        const context: WorkflowContext = {
            projectConfig,
            userRequest,
            stepResults: [],
            data: {},
        };

        this.logger.info(`开始工作流，共 ${this.steps.length} 个步骤`);

        const completedSteps: IWorkflowStep[] = [];

        for (let i = 0; i < this.steps.length; i++) {
            const step = this.steps[i]!;
            this.logger.info(`[${i + 1}/${this.steps.length}] ${step.name}: ${step.description}`);
            callbacks?.onStepStart?.(step.name, i, this.steps.length);

            try {
                // 执行步骤
                const result = await step.execute(context);
                context.stepResults.push(result);

                if (result.status === StepStatus.Failed) {
                    this.logger.error(`步骤 "${step.name}" 失败: ${result.error}`);
                    callbacks?.onStepFailed?.(step.name, result.error ?? '未知错误');

                    // 回滚已完成的步骤
                    await this.rollback(completedSteps, context);

                    this.status = WorkflowStatus.Failed;
                    const totalDuration = Date.now() - startTime;
                    callbacks?.onWorkflowFailed?.(result.error ?? '步骤执行失败');

                    return {
                        status: this.status,
                        stepResults: context.stepResults,
                        totalDuration,
                        error: result.error,
                    };
                }

                // 验证步骤
                const isValid = await step.validate(context);
                if (!isValid) {
                    const error = `步骤 "${step.name}" 验证失败`;
                    this.logger.error(error);
                    await this.rollback(completedSteps, context);

                    this.status = WorkflowStatus.Failed;
                    return {
                        status: this.status,
                        stepResults: context.stepResults,
                        totalDuration: Date.now() - startTime,
                        error,
                    };
                }

                completedSteps.push(step);
                this.logger.success(`步骤 "${step.name}" 完成`);
                callbacks?.onStepComplete?.(result);
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                this.logger.error(`步骤 "${step.name}" 抛出异常: ${errorMsg}`);
                callbacks?.onStepFailed?.(step.name, errorMsg);

                context.stepResults.push({
                    stepName: step.name,
                    status: StepStatus.Failed,
                    error: errorMsg,
                    startedAt: new Date(),
                    completedAt: new Date(),
                });

                await this.rollback(completedSteps, context);

                this.status = WorkflowStatus.Failed;
                return {
                    status: this.status,
                    stepResults: context.stepResults,
                    totalDuration: Date.now() - startTime,
                    error: errorMsg,
                };
            }
        }

        this.status = WorkflowStatus.Completed;
        const totalDuration = Date.now() - startTime;
        this.logger.success(`工作流完成，耗时 ${(totalDuration / 1000).toFixed(1)}s`);
        callbacks?.onWorkflowComplete?.(context.stepResults);

        return {
            status: this.status,
            stepResults: context.stepResults,
            totalDuration,
        };
    }

    /** 获取状态 */
    getStatus(): WorkflowStatus {
        return this.status;
    }

    /** 回滚已完成的步骤（逆序） */
    private async rollback(steps: IWorkflowStep[], context: WorkflowContext): Promise<void> {
        this.logger.warn(`开始回滚 ${steps.length} 个步骤...`);
        for (const step of [...steps].reverse()) {
            if (step.rollback) {
                try {
                    await step.rollback(context);
                    this.logger.info(`步骤 "${step.name}" 回滚成功`);
                } catch (err) {
                    this.logger.error(`步骤 "${step.name}" 回滚失败: ${err}`);
                }
            }
        }
    }
}
