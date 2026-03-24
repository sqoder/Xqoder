import {
    StepStatus,
    TestStatus,
    WorkflowStatus,
    type ProjectConfig,
    type StepResult,
    type TestReport,
} from '@xqoder/shared';
import { WorkflowEngine, deriveDefaultFailureBucket, findLastFailedStep } from '../engine.js';
import type { IWorkflowStep } from '../step.js';

export interface TestProjectFlowOptions {
    userRequest: string;
    projectConfig: ProjectConfig;
    testProject(projectDir: string): Promise<TestReport>;
}

export interface TestProjectFlowResult {
    status: WorkflowStatus;
    testReport?: TestReport;
    stepResults: StepResult[];
    totalDuration: number;
    attemptCount: number;
    failureBucket?: string;
    resultLabel?: string;
    error?: string;
}

export async function runTestProjectFlow(
    options: TestProjectFlowOptions,
): Promise<TestProjectFlowResult> {
    let testReport: TestReport | undefined;

    const engine = new WorkflowEngine().addStep(createRunTestsStep(async () => {
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
    }));

    const workflowResult = await engine.execute(
        options.userRequest,
        options.projectConfig,
    );

    return {
        status: workflowResult.status,
        testReport,
        stepResults: workflowResult.stepResults,
        totalDuration: workflowResult.totalDuration,
        attemptCount: 1,
        ...(workflowResult.status === WorkflowStatus.Failed
            ? { failureBucket: deriveTestFailureBucket(testReport, workflowResult.stepResults, workflowResult.error) }
            : {}),
        ...(testReport ? { resultLabel: resolveTestResultLabel(testReport) } : {}),
        ...(workflowResult.error ? { error: workflowResult.error } : {}),
    };
}

function createRunTestsStep(
    handler: () => Promise<string>,
): IWorkflowStep {
    return {
        name: 'run_tests',
        description: '运行项目测试并收集结果',
        async execute(_context) {
            const output = await handler();
            return {
                stepName: 'run_tests',
                status: StepStatus.Completed,
                output,
                startedAt: new Date(),
                completedAt: new Date(),
            };
        },
        async validate(_context) {
            return true;
        },
    };
}

function resolveTestResultLabel(report: TestReport): string {
    if (report.status === TestStatus.Passed) {
        return `${report.passed} passed`;
    }
    if (report.status === TestStatus.Skipped) {
        return 'skipped';
    }
    return `${report.failed} failed`;
}

function deriveTestFailureBucket(
    report: TestReport | undefined,
    stepResults: StepResult[],
    error: string | undefined,
): string {
    const failedStep = findLastFailedStep(stepResults)?.stepName;
    const failureText = [
        report?.output ?? '',
        ...(report?.failures ?? []).map((failure) => failure.message),
        error ?? '',
    ].join('\n').toLowerCase();

    if (failedStep === 'run_tests') {
        if (failureText.includes('超时') || failureText.includes('timeout')) {
            return 'test_timeout';
        }
        if (failureText.includes('package.json')) {
            return 'test_setup_failed';
        }
        return 'test_failed';
    }

    return deriveDefaultFailureBucket(stepResults) ?? 'test_failed';
}
