// ============================================================
// WorkflowEngine Core Class
// ============================================================

import {
    WorkflowStatus,
    StepStatus,
    type WorkflowContext,
    type StepResult,
    type ProjectConfig,
} from '@xqoder/shared';
import { Logger, logger as defaultLogger } from '@xqoder/shared';
import type { IWorkflowStep } from './step.js';

/** Workflow event callbacks */
export interface WorkflowCallbacks {
    onStepStart?: (stepName: string, index: number, total: number) => void;
    onStepComplete?: (result: StepResult) => void;
    onStepFailed?: (stepName: string, error: string) => void;
    onWorkflowComplete?: (results: StepResult[]) => void;
    onWorkflowFailed?: (error: string) => void;
}

/** Workflow execution result */
export interface WorkflowResult {
    status: WorkflowStatus;
    stepResults: StepResult[];
    totalDuration: number;
    error?: string;
}

/**
 * WorkflowEngine
 * Executes workflow steps in order, handles errors and rollbacks
 */
export class WorkflowEngine {
    private steps: IWorkflowStep[] = [];
    private status: WorkflowStatus = WorkflowStatus.Pending;
    private logger: Logger;

    constructor() {
        this.logger = defaultLogger.child('Workflow');
    }

    /**
     * Add a single step
     */
    addStep(step: IWorkflowStep): this {
        this.steps.push(step);
        return this;
    }

    /**
     * Add multiple steps in bulk
     */
    addSteps(steps: IWorkflowStep[]): this {
        this.steps.push(...steps);
        return this;
    }

    /**
     * Execute the workflow
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

        this.logger.info(`Starting workflow with ${this.steps.length} steps`);

        const completedSteps: IWorkflowStep[] = [];

        for (let i = 0; i < this.steps.length; i++) {
            const step = this.steps[i]!;
            this.logger.info(`[${i + 1}/${this.steps.length}] ${step.name}: ${step.description}`);
            callbacks?.onStepStart?.(step.name, i, this.steps.length);

            try {
                // Execute step
                const result = await step.execute(context);
                context.stepResults.push(result);

                if (result.status === StepStatus.Failed) {
                    this.logger.error(`Step "${step.name}" failed: ${result.error}`);
                    callbacks?.onStepFailed?.(step.name, result.error ?? 'Unknown error');

                    // Rollback completed steps
                    await this.rollback(completedSteps, context);

                    this.status = WorkflowStatus.Failed;
                    const totalDuration = Date.now() - startTime;
                    callbacks?.onWorkflowFailed?.(result.error ?? 'Step execution failed');

                    return {
                        status: this.status,
                        stepResults: context.stepResults,
                        totalDuration,
                        error: result.error,
                    };
                }

                // Validate step
                const isValid = await step.validate(context);
                if (!isValid) {
                    const error = `Step "${step.name}" validation failed`;
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
                this.logger.success(`Step "${step.name}" completed`);
                callbacks?.onStepComplete?.(result);
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                this.logger.error(`Step "${step.name}" threw an exception: ${errorMsg}`);
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
        this.logger.success(`Workflow completed in ${(totalDuration / 1000).toFixed(1)}s`);
        callbacks?.onWorkflowComplete?.(context.stepResults);

        return {
            status: this.status,
            stepResults: context.stepResults,
            totalDuration,
        };
    }

    /** Get current status */
    getStatus(): WorkflowStatus {
        return this.status;
    }

    /** Rollback completed steps in reverse order */
    private async rollback(steps: IWorkflowStep[], context: WorkflowContext): Promise<void> {
        this.logger.warn(`Starting rollback for ${steps.length} steps...`);
        for (const step of [...steps].reverse()) {
            if (step.rollback) {
                try {
                    await step.rollback(context);
                    this.logger.info(`Step "${step.name}" rolled back successfully`);
                } catch (err) {
                    this.logger.error(`Step "${step.name}" rollback failed: ${err}`);
                }
            }
        }
    }
}
