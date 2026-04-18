// ============================================================
// Workflow Step Abstraction
// ============================================================

import type { StepResult, StepStatus, WorkflowContext } from '@xqoder/shared';

/**
 * WorkflowStep Interface
 * Every workflow step must implement this interface
 */
export interface IWorkflowStep {
    /** Step name */
    readonly name: string;
    /** Step description */
    readonly description: string;

    /**
     * Execute the step
     * @returns Execution result
     */
    execute(context: WorkflowContext): Promise<StepResult>;

    /**
     * Validate the step execution result
     * @returns Whether validation passed
     */
    validate(context: WorkflowContext): Promise<boolean>;

    /**
     * Rollback the step (optional)
     * Called when subsequent steps fail
     */
    rollback?(context: WorkflowContext): Promise<void>;
}

/**
 * BaseStep Class
 * Provides common helper methods for steps
 */
export abstract class BaseStep implements IWorkflowStep {
    abstract readonly name: string;
    abstract readonly description: string;

    abstract execute(context: WorkflowContext): Promise<StepResult>;

    async validate(_context: WorkflowContext): Promise<boolean> {
        // Default validation: check if the latest step result was successful
        const lastResult = _context.stepResults[_context.stepResults.length - 1];
        return lastResult?.status === ('completed' as StepStatus);
    }

    /** Create a successful result */
    protected success(output?: string): StepResult {
        return {
            stepName: this.name,
            status: 'completed' as StepStatus,
            output,
            startedAt: new Date(),
            completedAt: new Date(),
        };
    }

    /** Create a failed result */
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
