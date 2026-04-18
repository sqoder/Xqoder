// ============================================================
// Repair Project Workflow Template
// ============================================================

import type { WorkflowContext, StepResult } from '@xqoder/shared';
import { BaseStep } from '../step.js';

export interface FixWorkflowHandlers {
    runAndDetectErrors(context: WorkflowContext): Promise<string | void>;
    analyzeErrors(context: WorkflowContext): Promise<string | void>;
    generateFix(context: WorkflowContext): Promise<string | void>;
    applyFix(context: WorkflowContext): Promise<string | void>;
    verifyFix(context: WorkflowContext): Promise<string | void>;
}

/**
 * Step 1: Run project to detect errors
 */
export class RunAndDetectErrorsStep extends BaseStep {
    readonly name = 'run_and_detect';
    readonly description = 'Run project and capture errors';

    constructor(private readonly handler: FixWorkflowHandlers['runAndDetectErrors']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = (await this.handler(context)) || '';
        context.data['detectedErrors'] = output || 'Error detection complete';
        return this.success(output || 'Error detection complete');
    }
}

/**
 * Step 2: Analyze Errors
 */
export class AnalyzeErrorsStep extends BaseStep {
    readonly name = 'analyze_errors';
    readonly description = 'AI analyzes captured errors';

    constructor(private readonly handler: FixWorkflowHandlers['analyzeErrors']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = (await this.handler(context)) || '';
        context.data['errorAnalysis'] = output || 'Error analysis complete';
        return this.success(output || 'Error analysis complete');
    }
}

/**
 * Step 3: Generate Fix
 */
export class GenerateFixStep extends BaseStep {
    readonly name = 'generate_fix';
    readonly description = 'AI generates fix code';

    constructor(private readonly handler: FixWorkflowHandlers['generateFix']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = (await this.handler(context)) || '';
        context.data['generatedFix'] = output || 'Fix plan generation complete';
        return this.success(output || 'Fix plan generation complete');
    }
}

/**
 * Step 4: Apply Fix
 */
export class ApplyFixStep extends BaseStep {
    readonly name = 'apply_fix';
    readonly description = 'Apply fix code to project';

    constructor(private readonly handler: FixWorkflowHandlers['applyFix']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = (await this.handler(context)) || '';
        context.data['appliedFix'] = output || 'Fix applied';
        return this.success(output || 'Fix applied');
    }
}

/**
 * Step 5: Re-run verification
 */
export class VerifyFixStep extends BaseStep {
    readonly name = 'verify_fix';
    readonly description = 'Re-run project to verify fix effect';

    constructor(private readonly handler: FixWorkflowHandlers['verifyFix']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = (await this.handler(context)) || '';
        context.data['fixVerification'] = output || 'Fix verification passed';
        return this.success(output || 'Fix verification passed');
    }
}

/**
 * Create a list of repair workflow steps
 */
export function createFixProjectSteps(handlers: FixWorkflowHandlers): BaseStep[] {
    return [
        new RunAndDetectErrorsStep(handlers.runAndDetectErrors),
        new AnalyzeErrorsStep(handlers.analyzeErrors),
        new GenerateFixStep(handlers.generateFix),
        new ApplyFixStep(handlers.applyFix),
        new VerifyFixStep(handlers.verifyFix),
    ];
}
