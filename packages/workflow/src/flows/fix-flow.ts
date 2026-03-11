// ============================================================
// 修复项目闭环工作流
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
                return `捕获到 ${initialCapture.analysis.errors.length} 个错误，状态: ${initialCapture.runReport.status}`;
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
                    ? `修复验证通过: ${verificationCapture.runReport.url}`
                    : '修复验证通过';
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
        error: lastAttempt?.error ?? '达到最大修复尝试次数',
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
            summaryForAgent: '没有检测到错误。',
        };
    }

    return {
        errors: runReport.errors,
        autoFixCommands: [],
        summaryForAgent: [
            '检测到运行失败，但未生成结构化日志摘要：',
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
        `你正在执行第 ${attempt}/${maxAttempts} 次项目修复。`,
        `原始任务: ${userRequest}`,
        '',
        '运行报告:',
        `- 项目目录: ${runReport.projectDir}`,
        `- 项目类型: ${runReport.projectType}`,
        `- 框架: ${runReport.framework ?? 'unknown'}`,
        `- 包管理器: ${runReport.packageManager ?? 'unknown'}`,
        `- 启动命令: ${runReport.command ?? 'unknown'}`,
        `- 状态: ${runReport.status}`,
        `- URL: ${runReport.url ?? 'N/A'}`,
        '',
        '错误摘要:',
        analysis.summaryForAgent,
        '',
        '要求:',
        '- 读取相关源文件',
        '- 只修复当前启动或编译问题',
        '- 不要改变原有功能目标',
        '- 修改完成后让系统重新运行验证',
    ].join('\n');
}
