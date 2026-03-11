// ============================================================
// 构建项目工作流模板
// ============================================================

import type { WorkflowContext, StepResult } from '@xqoder/shared';
import { BaseStep } from '../step.js';

export interface BuildWorkflowHandlers {
    analyzeRequirements(context: WorkflowContext): Promise<string | void>;
    generateStructure(context: WorkflowContext): Promise<string | void>;
    generateCode(context: WorkflowContext): Promise<string | void>;
    installDependencies(context: WorkflowContext): Promise<string | void>;
    runProject(context: WorkflowContext): Promise<string | void>;
    runTests(context: WorkflowContext): Promise<string | void>;
}

/**
 * 步骤1：分析需求
 */
export class AnalyzeRequirementsStep extends BaseStep {
    readonly name = 'analyze_requirements';
    readonly description = '分析用户需求，确定项目类型和结构';

    constructor(private readonly handler: BuildWorkflowHandlers['analyzeRequirements']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = await this.handler(context);
        context.data['requirementsAnalysis'] = output ?? context.userRequest;
        return this.success(output ?? `需求分析完成: ${context.userRequest}`);
    }
}

/**
 * 步骤2：生成项目结构
 */
export class GenerateStructureStep extends BaseStep {
    readonly name = 'generate_structure';
    readonly description = '生成项目目录结构';

    constructor(private readonly handler: BuildWorkflowHandlers['generateStructure']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = await this.handler(context);
        context.data['projectStructure'] = output ?? context.projectConfig.rootDir;
        return this.success(output ?? `项目结构已在 ${context.projectConfig.rootDir} 生成`);
    }
}

/**
 * 步骤3：生成代码
 */
export class GenerateCodeStep extends BaseStep {
    readonly name = 'generate_code';
    readonly description = 'AI 生成项目代码';

    constructor(private readonly handler: BuildWorkflowHandlers['generateCode']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = await this.handler(context);
        context.data['generatedCode'] = output ?? '代码生成完成';
        return this.success(output ?? '代码生成完成');
    }
}

/**
 * 步骤4：安装依赖
 */
export class InstallDependenciesStep extends BaseStep {
    readonly name = 'install_dependencies';
    readonly description = '安装项目依赖包';

    constructor(private readonly handler: BuildWorkflowHandlers['installDependencies']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = await this.handler(context);
        context.data['dependencyInstallation'] = output ?? '依赖安装完成';
        return this.success(output ?? '依赖安装完成');
    }
}

/**
 * 步骤5：运行项目
 */
export class RunProjectStep extends BaseStep {
    readonly name = 'run_project';
    readonly description = '启动项目并验证运行状态';

    constructor(private readonly handler: BuildWorkflowHandlers['runProject']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = await this.handler(context);
        context.data['runValidation'] = output ?? '项目启动成功';
        return this.success(output ?? '项目启动成功');
    }
}

/**
 * 步骤6：运行测试
 */
export class RunTestsStep extends BaseStep {
    readonly name = 'run_tests';
    readonly description = '运行项目测试';

    constructor(private readonly handler: BuildWorkflowHandlers['runTests']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = await this.handler(context);
        context.data['testValidation'] = output ?? '测试通过';
        return this.success(output ?? '测试通过');
    }
}

/**
 * 创建完整构建工作流的步骤列表
 */
export function createBuildProjectSteps(handlers: BuildWorkflowHandlers): BaseStep[] {
    return [
        new AnalyzeRequirementsStep(handlers.analyzeRequirements),
        new GenerateStructureStep(handlers.generateStructure),
        new GenerateCodeStep(handlers.generateCode),
        new InstallDependenciesStep(handlers.installDependencies),
        new RunProjectStep(handlers.runProject),
        new RunTestsStep(handlers.runTests),
    ];
}
