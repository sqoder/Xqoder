// ============================================================
// Project Repair Closed-loop Workflow
// ============================================================

import {
    RuntimeStatus,
    WorkflowStatus,
    type ProjectConfig,
    type RunReport,
    type StepResult,
} from '@xqoder/shared';
import type { ErrorAnalysis } from '@xqoder/runtime';
import { WorkflowEngine } from '../engine.js';
import { createFixProjectSteps } from '../templates/fix-project.js';

export interface FixProjectFlowRuntime {
    start(projectDir: string, options?: { command?: string; port?: number }): Promise<RunReport>;
    stop(): Promise<void>;
    analyzeErrors(): ErrorAnalysis | null;
}

export interface RepairProjectInput {
    attempt: number;
    maxAttempts: number;
    prompt: string;
    runReport: RunReport;
    analysis: ErrorAnalysis;
    projectConfig: ProjectConfig;
}

export interface FixProjectFlowAttempt {
    attempt: number;
    initialRunReport: RunReport;
    initialAnalysis: ErrorAnalysis;
    fixPrompt?: string;
    repairOutput?: string;
    verificationRunReport?: RunReport;
    verificationAnalysis?: ErrorAnalysis;
    workflowStatus: WorkflowStatus;
    stepResults: StepResult[];
    error?: string;
}

export interface FixProjectFlowResult {
    status: WorkflowStatus;
    attempts: FixProjectFlowAttempt[];
    totalDuration: number;
    finalRunReport?: RunReport;
    error?: string;
}

export interface FixProjectFlowOptions {
    userRequest: string;
    projectConfig: ProjectConfig;
    runtimeFactory: () => FixProjectFlowRuntime;
    repairProject(input: RepairProjectInput): Promise<string>;
    maxAttempts?: number;
}

interface RuntimeCapture {
    runReport: RunReport;
    analysis: ErrorAnalysis;
}

export async function runFixProjectFlow(options: FixProjectFlowOptions): Promise<FixProjectFlowResult> {
    const startedAt = Date.now();
    const attempts: FixProjectFlowAttempt[] = [];
    const maxAttempts = options.maxAttempts ?? 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const initialCapture = await captureRuntimeState(options.runtimeFactory, options.projectConfig.rootDir);
        const attemptRecord: FixProjectFlowAttempt = {
            attempt,
            initialRunReport: initialCapture.runReport,
            initialAnalysis: initialCapture.analysis,
            workflowStatus: WorkflowStatus.Pending,
            stepResults: [],
        };

        if (isHealthy(initialCapture)) {
            attemptRecord.workflowStatus = WorkflowStatus.Completed;
            attempts.push(attemptRecord);
            return {
                status: WorkflowStatus.Completed,
                attempts,
                totalDuration: Date.now() - startedAt,
                finalRunReport: initialCapture.runReport,
            };
        }

        const engine = new WorkflowEngine().addSteps(createFixProjectSteps({
            runAndDetectErrors: async () => {
                return `Captured ${initialCapture.analysis.errors.length} errors, status: ${initialCapture.runReport.status}`;
            },
            analyzeErrors: async () => {
                return initialCapture.analysis.summaryForAgent;
            },
            generateFix: async () => {
                const prompt = buildRepairPrompt({
                    attempt,
                    maxAttempts,
                    userRequest: options.userRequest,
                    runReport: initialCapture.runReport,
                    analysis: initialCapture.analysis,
                });
                attemptRecord.fixPrompt = prompt;
                return prompt;
            },
            applyFix: async () => {
                const output = await options.repairProject({
                    attempt,
                    maxAttempts,
                    prompt: attemptRecord.fixPrompt ?? '',
                    runReport: initialCapture.runReport,
                    analysis: initialCapture.analysis,
                    projectConfig: options.projectConfig,
                });
                attemptRecord.repairOutput = output;
                return output;
            },
            verifyFix: async () => {
                const verificationCapture = await captureRuntimeState(
                    options.runtimeFactory,
                    options.projectConfig.rootDir,
                );

                attemptRecord.verificationRunReport = verificationCapture.runReport;
                attemptRecord.verificationAnalysis = verificationCapture.analysis;

                if (!isHealthy(verificationCapture)) {
                    throw new Error(verificationCapture.analysis.summaryForAgent);
                }

                return verificationCapture.runReport.url
                    ? `Fix verification passed: ${verificationCapture.runReport.url}`
                    : 'Fix verification passed';
            },
        }));

        const workflowResult = await engine.execute(
            options.userRequest,
            options.projectConfig,
        );

        attemptRecord.workflowStatus = workflowResult.status;
        attemptRecord.stepResults = workflowResult.stepResults;
        attemptRecord.error = workflowResult.error;
        attempts.push(attemptRecord);

        if (workflowResult.status === WorkflowStatus.Completed) {
            return {
                status: WorkflowStatus.Completed,
                attempts,
                totalDuration: Date.now() - startedAt,
                finalRunReport: attemptRecord.verificationRunReport ?? initialCapture.runReport,
            };
        }
    }

    const lastAttempt = attempts[attempts.length - 1];
    return {
        status: WorkflowStatus.Failed,
        attempts,
        totalDuration: Date.now() - startedAt,
        finalRunReport: lastAttempt?.verificationRunReport ?? lastAttempt?.initialRunReport,
        error: lastAttempt?.error ?? 'Maximum repair attempts reached',
    };
}

async function captureRuntimeState(
    runtimeFactory: () => FixProjectFlowRuntime,
    projectDir: string,
): Promise<RuntimeCapture> {
    const runtime = runtimeFactory();

    try {
        const runReport = await runtime.start(projectDir);
        const analysis = normalizeAnalysis(runReport, runtime.analyzeErrors());
        return {
            runReport,
            analysis,
        };
    } finally {
        await runtime.stop();
    }
}

function normalizeAnalysis(runReport: RunReport, analysis: ErrorAnalysis | null): ErrorAnalysis {
    if (analysis) {
        return analysis;
    }

    if (runReport.errors.length === 0) {
        return {
            errors: [],
            autoFixCommands: [],
            summaryForAgent: 'No errors detected.',
        };
    }

    return {
        errors: runReport.errors,
        autoFixCommands: [],
        summaryForAgent: [
            'Run failed detected, but no structured log summary generated:',
            ...runReport.errors.map((error) => `- ${error.message}`),
        ].join('\n'),
    };
}

function isHealthy(capture: RuntimeCapture): boolean {
    return capture.runReport.status === RuntimeStatus.Running
        && capture.analysis.errors.length === 0;
}

function buildRepairPrompt(input: {
    attempt: number;
    maxAttempts: number;
    userRequest: string;
    runReport: RunReport;
    analysis: ErrorAnalysis;
}): string {
    const { attempt, maxAttempts, userRequest, runReport, analysis } = input;

    return [
        `You are performing project repair attempt ${attempt}/${maxAttempts}.`,
        `Original task: ${userRequest}`,
        '',
        'Run Report:',
        `- Project Directory: ${runReport.projectDir}`,
        `- Project Type: ${runReport.projectType}`,
        `- Framework: ${runReport.framework ?? 'unknown'}`,
        `- Package Manager: ${runReport.packageManager ?? 'unknown'}`,
        `- Start Command: ${runReport.command ?? 'unknown'}`,
        `- Status: ${runReport.status}`,
        `- URL: ${runReport.url ?? 'N/A'}`,
        '',
        'Error Summary:',
        analysis.summaryForAgent,
        '',
        'Requirements:',
        '- Read related source files',
        '- Only fix current start or compilation issues',
        '- Do not change original functional objectives',
        '- After modification, let the system re-run verification',
    ].join('\n');
}
