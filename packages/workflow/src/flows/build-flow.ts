import {
    RuntimeErrorType,
    RuntimeStatus,
    TestStatus,
    WorkflowStatus,
    type ProjectConfig,
    type RunReport,
    type StepResult,
    type TestReport,
} from '@xqoder/shared';
import { WorkflowEngine, deriveDefaultFailureBucket, findLastFailedStep } from '../engine.js';
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
    attemptCount: number;
    failureBucket?: string;
    resultLabel?: string;
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
                const message = runReport.errors.map((error) => error.message).join('\n') || '项目启动失败';
                throw new Error(message);
            }

            return runReport.url
                ? `项目运行验证通过: ${runReport.url}`
                : '项目运行验证通过';
        },
        runTests: async () => {
            if (!options.testProject) {
                return '未配置测试验证，跳过';
            }

            testReport = await options.testProject(options.projectConfig.rootDir);
            if (testReport.status === TestStatus.Failed) {
                const message = testReport.failures.map((failure) => failure.message).join('\n')
                    || '测试失败';
                throw new Error(message);
            }

            if (testReport.status === TestStatus.Skipped) {
                return testReport.output;
            }

            return `测试通过: ${testReport.passed} passed`;
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
        attemptCount: 1,
        ...(workflowResult.status === WorkflowStatus.Failed
            ? { failureBucket: deriveBuildFailureBucket(runReport, testReport, workflowResult.stepResults) }
            : {}),
        ...((runReport ?? testReport)
            ? { resultLabel: resolveBuildResultLabel(runReport, testReport) }
            : {}),
        error: workflowResult.error,
    };
}

function resolveBuildResultLabel(
    runReport: RunReport | undefined,
    testReport: TestReport | undefined,
): string {
    if (testReport?.status === TestStatus.Passed) {
        return `${testReport.passed} passed`;
    }
    if (testReport?.status === TestStatus.Skipped) {
        return 'tests skipped';
    }
    if (testReport?.status === TestStatus.Failed) {
        return `${testReport.failed} failed`;
    }
    if (runReport?.url) {
        return runReport.url;
    }
    return runReport?.status ?? 'build_pending';
}

function deriveBuildFailureBucket(
    runReport: RunReport | undefined,
    testReport: TestReport | undefined,
    stepResults: StepResult[],
): string {
    const failedStep = findLastFailedStep(stepResults)?.stepName;
    if (failedStep === 'run_project') {
        return resolveRuntimeFailureBucket(runReport);
    }
    if (failedStep === 'run_tests') {
        return resolveTestFailureBucket(testReport);
    }
    return deriveDefaultFailureBucket(stepResults) ?? 'build_failed';
}

function resolveRuntimeFailureBucket(runReport: RunReport | undefined): string {
    const runtimeErrorType = runReport?.errors[0]?.type;
    switch (runtimeErrorType) {
        case RuntimeErrorType.DependencyMissing:
            return 'runtime_dependency_missing';
        case RuntimeErrorType.CompileError:
            return 'runtime_compile_error';
        case RuntimeErrorType.PortConflict:
            return 'runtime_port_conflict';
        case RuntimeErrorType.ConfigError:
            return 'runtime_config_error';
        case RuntimeErrorType.PermissionDenied:
            return 'runtime_permission_denied';
        case RuntimeErrorType.RuntimeException:
            return 'runtime_exception';
        default:
            return 'runtime_failed';
    }
}

function resolveTestFailureBucket(testReport: TestReport | undefined): string {
    if (!testReport) {
        return 'test_failed';
    }
    const failureText = [
        testReport.output,
        ...testReport.failures.map((failure) => failure.message),
    ].join('\n').toLowerCase();
    if (failureText.includes('超时') || failureText.includes('timeout')) {
        return 'test_timeout';
    }
    if (failureText.includes('package.json')) {
        return 'test_setup_failed';
    }
    return 'test_failed';
}
