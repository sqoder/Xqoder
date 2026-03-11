// ============================================================
// 修复项目工作流模板
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
 * 步骤1：运行项目检测错误
 */
export class RunAndDetectErrorsStep extends BaseStep {
    readonly name = 'run_and_detect';
    readonly description = '运行项目并捕获错误';

    constructor(private readonly handler: FixWorkflowHandlers['runAndDetectErrors']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = await this.handler(context);
        context.data['detectedErrors'] = output ?? '错误检测完成';
        return this.success(output ?? '错误检测完成');
    }
}

/**
 * 步骤2：分析错误
 */
export class AnalyzeErrorsStep extends BaseStep {
    readonly name = 'analyze_errors';
    readonly description = 'AI 分析捕获的错误';

    constructor(private readonly handler: FixWorkflowHandlers['analyzeErrors']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = await this.handler(context);
        context.data['errorAnalysis'] = output ?? '错误分析完成';
        return this.success(output ?? '错误分析完成');
    }
}

/**
 * 步骤3：生成修复
 */
export class GenerateFixStep extends BaseStep {
    readonly name = 'generate_fix';
    readonly description = 'AI 生成修复代码';

    constructor(private readonly handler: FixWorkflowHandlers['generateFix']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = await this.handler(context);
        context.data['generatedFix'] = output ?? '修复方案生成完成';
        return this.success(output ?? '修复方案生成完成');
    }
}

/**
 * 步骤4：应用修复
 */
export class ApplyFixStep extends BaseStep {
    readonly name = 'apply_fix';
    readonly description = '应用修复代码到项目';

    constructor(private readonly handler: FixWorkflowHandlers['applyFix']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = await this.handler(context);
        context.data['appliedFix'] = output ?? '修复已应用';
        return this.success(output ?? '修复已应用');
    }
}

/**
 * 步骤5：重新运行验证
 */
export class VerifyFixStep extends BaseStep {
    readonly name = 'verify_fix';
    readonly description = '重新运行项目验证修复效果';

    constructor(private readonly handler: FixWorkflowHandlers['verifyFix']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = await this.handler(context);
        context.data['fixVerification'] = output ?? '修复验证通过';
        return this.success(output ?? '修复验证通过');
    }
}

/**
 * 创建修复工作流步骤列表
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
