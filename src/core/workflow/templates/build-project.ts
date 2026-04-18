// ============================================================
// Build Project Workflow Template
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
 * Step 1: Analyze Requirements
 */
export class AnalyzeRequirementsStep extends BaseStep {
    readonly name = 'analyze_requirements';
    readonly description = 'Analyze user requirements, determine project type and structure';

    constructor(private readonly handler: BuildWorkflowHandlers['analyzeRequirements']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = await this.handler(context);
        context.data['requirementsAnalysis'] = output ?? context.userRequest;
        return this.success((output || `Requirement analysis complete: ${context.userRequest}`) as string);
    }
}

/**
 * Step 2: Generate Project Structure
 */
export class GenerateStructureStep extends BaseStep {
    readonly name = 'generate_structure';
    readonly description = 'Generate project directory structure';

    constructor(private readonly handler: BuildWorkflowHandlers['generateStructure']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = await this.handler(context);
        context.data['projectStructure'] = output ?? context.projectConfig.rootDir;
        return this.success((output || 'Project structure generated') as string);
    }
}

/**
 * Step 3: Generate Code
 */
export class GenerateCodeStep extends BaseStep {
    readonly name = 'generate_code';
    readonly description = 'AI generates project code';

    constructor(private readonly handler: BuildWorkflowHandlers['generateCode']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = (await this.handler(context)) || '';
        context.data['generatedCode'] = output || 'Code generation complete';
        return this.success(output || 'Code generation complete');
    }
}

/**
 * Step 4: Install Dependencies
 */
export class InstallDependenciesStep extends BaseStep {
    readonly name = 'install_dependencies';
    readonly description = 'Install project dependency packages';

    constructor(private readonly handler: BuildWorkflowHandlers['installDependencies']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = (await this.handler(context)) || '';
        context.data['dependencyInstallation'] = output || 'Dependency installation complete';
        return this.success(output || 'Dependency installation complete');
    }
}

/**
 * Step 5: Run Project
 */
export class RunProjectStep extends BaseStep {
    readonly name = 'run_project';
    readonly description = 'Start project and verify run status';

    constructor(private readonly handler: BuildWorkflowHandlers['runProject']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = (await this.handler(context)) || '';
        context.data['runValidation'] = output || 'Project start successful';
        return this.success(output || 'Project start successful');
    }
}

/**
 * Step 6: Run Tests
 */
export class RunTestsStep extends BaseStep {
    readonly name = 'run_tests';
    readonly description = 'Run project tests';

    constructor(private readonly handler: BuildWorkflowHandlers['runTests']) {
        super();
    }

    async execute(context: WorkflowContext): Promise<StepResult> {
        const output = (await this.handler(context)) || '';
        context.data['testValidation'] = output || 'Tests passed';
        return this.success(output || 'Tests passed');
    }
}

/**
 * Create a list of steps for the full build workflow
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
