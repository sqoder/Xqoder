import {
    RuntimeStatus,
    TestStatus,
    WorkflowStatus,
    type ProjectConfig,
    type RunReport,
    type StepResult,
    type TestReport,
} from '@xqoder/shared';
import { WorkflowEngine } from '../engine.js';
import { createBuildProjectSteps } from '../templates/build-project.js';

export interface BuildProjectFlowRuntime {
    start(projectDir: string, options?: { command?: string; port?: number }): Promise<RunReport>;
    stop(): Promise<void>;
}

export interface BuildProjectFlowOptions {
    userRequest: string;
    projectConfig: ProjectConfig;
    analyzeRequirements(): Promise<string>;
    generateStructure(analysis: string): Promise<string>;
    generateCode(analysis: string): Promise<string>;
    installDependencies(): Promise<string>;
    runtimeFactory: () => BuildProjectFlowRuntime;
    testProject?: (projectDir: string) => Promise<TestReport>;
}

export interface BuildProjectFlowResult {
    status: WorkflowStatus;
    analysis?: string;
    runReport?: RunReport;
    testReport?: TestReport;
    stepResults: StepResult[];
    totalDuration: number;
    error?: string;
}

export async function runBuildProjectFlow(
    options: BuildProjectFlowOptions,
): Promise<BuildProjectFlowResult> {
    let analysis = '';
    let runReport: RunReport | undefined;
    let testReport: TestReport | undefined;

    const engine = new WorkflowEngine().addSteps(createBuildProjectSteps({
        analyzeRequirements: async () => {
            analysis = await options.analyzeRequirements();
            return analysis;
        },
        generateStructure: async () => {
            return options.generateStructure(analysis);
        },
        generateCode: async () => {
            return options.generateCode(analysis);
        },
        installDependencies: async () => {
            return options.installDependencies();
        },
        runProject: async () => {
            const runtime = options.runtimeFactory();
            try {
                runReport = await runtime.start(options.projectConfig.rootDir);
            } finally {
                await runtime.stop();
            }

            if (runReport.status !== RuntimeStatus.Running) {
                const message = runReport.errors.map((error) => error.message).join('\n') || 'Project start failed';
                throw new Error(message);
            }

            return runReport.url
                ? `Project run verification passed: ${runReport.url}`
                : 'Project run verification passed';
        },
        runTests: async () => {
            if (!options.testProject) {
                return 'No test verification configured, skipping';
            }

            testReport = await options.testProject(options.projectConfig.rootDir);
            if (testReport.status === TestStatus.Failed) {
                const message = testReport.failures.map((failure) => failure.message).join('\n')
                    || 'Test failed';
                throw new Error(message);
            }

            if (testReport.status === TestStatus.Skipped) {
                return testReport.output;
            }

            return `Tests passed: ${testReport.passed} passed`;
        },
    }));

    const workflowResult = await engine.execute(
        options.userRequest,
        options.projectConfig,
    );

    return {
        status: workflowResult.status,
        analysis: analysis || undefined,
        runReport,
        testReport,
        stepResults: workflowResult.stepResults,
        totalDuration: workflowResult.totalDuration,
        error: workflowResult.error,
    };
}
