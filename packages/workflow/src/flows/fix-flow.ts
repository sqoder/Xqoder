// ============================================================
// 修复项目闭环工作流
// ============================================================

import {
    RuntimeErrorType,
    RuntimeStatus,
    WorkflowStatus,
    type ProjectConfig,
    type RunReport,
    type StepResult,
} from '@xqoder/shared';
import type { ErrorAnalysis } from '@xqoder/runtime';
import { WorkflowEngine, deriveDefaultFailureBucket, findLastFailedStep } from '../engine.js';
import {
    resolveRemediationPolicy,
    resolveRemediationMaxAttempts,
    type RemediationPolicy,
} from '../remediation-policy.js';
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
    suspectedFailureBucket: string;
    remediationPolicy: RemediationPolicy;
}

export interface SafeAutomaticRemediationInput {
    attempt: number;
    maxAttempts: number;
    runReport: RunReport;
    analysis: ErrorAnalysis;
    projectConfig: ProjectConfig;
    suspectedFailureBucket: string;
    remediationPolicy: RemediationPolicy;
}

export interface SafeAutomaticRemediationResult {
    actionId: string;
    summary: string;
    output?: string;
}

export interface FixProjectFlowAttempt {
    attempt: number;
    initialRunReport: RunReport;
    initialAnalysis: ErrorAnalysis;
    fixPrompt?: string;
    repairOutput?: string;
    automaticActionId?: string;
    automaticActionPolicyId?: string;
    automaticActionSummary?: string;
    automaticActionOutput?: string;
    automaticActionTriggerBucket?: string;
    automaticActionRunReport?: RunReport;
    automaticActionAnalysis?: ErrorAnalysis;
    verificationRunReport?: RunReport;
    verificationAnalysis?: ErrorAnalysis;
    workflowStatus: WorkflowStatus;
    stepResults: StepResult[];
    error?: string;
    failureBucket?: string;
    suspectedFailureBucket?: string;
    remediationPolicyId?: string;
}

export interface FixProjectFlowResult {
    status: WorkflowStatus;
    attempts: FixProjectFlowAttempt[];
    totalDuration: number;
    attemptCount: number;
    appliedPolicyIds: string[];
    automaticActionIds: string[];
    observedFailureBuckets: string[];
    failureBucket?: string;
    resultLabel?: string;
    finalRunReport?: RunReport;
    error?: string;
}

export interface FixProjectFlowOptions {
    userRequest: string;
    projectConfig: ProjectConfig;
    runtimeFactory: () => FixProjectFlowRuntime;
    repairProject(input: RepairProjectInput): Promise<string>;
    applySafeAutomaticRemediation?(input: SafeAutomaticRemediationInput): Promise<SafeAutomaticRemediationResult | null>;
    enhanceAnalysis?(analysis: ErrorAnalysis, runReport: RunReport): Promise<ErrorAnalysis> | ErrorAnalysis;
    maxAttempts?: number;
}

interface RuntimeCapture {
    runReport: RunReport;
    analysis: ErrorAnalysis;
}

export async function runFixProjectFlow(options: FixProjectFlowOptions): Promise<FixProjectFlowResult> {
    const startedAt = Date.now();
    const attempts: FixProjectFlowAttempt[] = [];
    const maxAttempts = resolveRemediationMaxAttempts(options.maxAttempts);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const initialCapture = await captureRuntimeState(
            options.runtimeFactory,
            options.projectConfig.rootDir,
            options.enhanceAnalysis,
        );
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
                attemptCount: attempts.length,
                appliedPolicyIds: [],
                automaticActionIds: [],
                observedFailureBuckets: [],
                resultLabel: initialCapture.runReport.url ?? 'healthy',
                finalRunReport: initialCapture.runReport,
            };
        }

        let workingCapture = initialCapture;
        let remediationPolicy = resolveRemediationPolicy({
            runReport: workingCapture.runReport,
            analysis: workingCapture.analysis,
            attempt,
            maxAttempts,
            previousAttempts: attempts,
        });
        attemptRecord.suspectedFailureBucket = remediationPolicy.bucket;
        attemptRecord.remediationPolicyId = remediationPolicy.id;

        if (options.applySafeAutomaticRemediation) {
            const safeAutomaticRemediation = await options.applySafeAutomaticRemediation({
                attempt,
                maxAttempts,
                runReport: workingCapture.runReport,
                analysis: workingCapture.analysis,
                projectConfig: options.projectConfig,
                suspectedFailureBucket: remediationPolicy.bucket,
                remediationPolicy,
            });

            if (safeAutomaticRemediation) {
                attemptRecord.automaticActionId = safeAutomaticRemediation.actionId;
                attemptRecord.automaticActionPolicyId = remediationPolicy.id;
                attemptRecord.automaticActionSummary = safeAutomaticRemediation.summary;
                attemptRecord.automaticActionOutput = safeAutomaticRemediation.output;
                attemptRecord.automaticActionTriggerBucket = remediationPolicy.bucket;

                const automaticActionCapture = await captureRuntimeState(
                    options.runtimeFactory,
                    options.projectConfig.rootDir,
                    options.enhanceAnalysis,
                );
                attemptRecord.automaticActionRunReport = automaticActionCapture.runReport;
                attemptRecord.automaticActionAnalysis = automaticActionCapture.analysis;

                if (isHealthy(automaticActionCapture)) {
                    attemptRecord.workflowStatus = WorkflowStatus.Completed;
                    attemptRecord.verificationRunReport = automaticActionCapture.runReport;
                    attemptRecord.verificationAnalysis = automaticActionCapture.analysis;
                    attempts.push(attemptRecord);

                    return {
                        status: WorkflowStatus.Completed,
                        attempts,
                        totalDuration: Date.now() - startedAt,
                        attemptCount: attempts.length,
                        appliedPolicyIds: collectAppliedPolicyIds(attempts),
                        automaticActionIds: collectAutomaticActionIds(attempts),
                        observedFailureBuckets: collectObservedFailureBuckets(attempts),
                        resultLabel: automaticActionCapture.runReport.url ?? safeAutomaticRemediation.summary,
                        finalRunReport: automaticActionCapture.runReport,
                    };
                }

                workingCapture = automaticActionCapture;
                remediationPolicy = resolveRemediationPolicy({
                    runReport: workingCapture.runReport,
                    analysis: workingCapture.analysis,
                    attempt,
                    maxAttempts,
                    previousAttempts: attempts,
                });
                attemptRecord.suspectedFailureBucket = remediationPolicy.bucket;
                attemptRecord.remediationPolicyId = remediationPolicy.id;
            }
        }

        const engine = new WorkflowEngine().addSteps(createFixProjectSteps({
            runAndDetectErrors: async () => {
                return `捕获到 ${workingCapture.analysis.errors.length} 个错误，状态: ${workingCapture.runReport.status}`;
            },
            analyzeErrors: async () => {
                return workingCapture.analysis.summaryForAgent;
            },
            generateFix: async () => {
                const prompt = buildRepairPrompt({
                    attempt,
                    maxAttempts,
                    userRequest: options.userRequest,
                    runReport: workingCapture.runReport,
                    analysis: workingCapture.analysis,
                    remediationPolicy,
                    previousAttempts: attempts,
                });
                attemptRecord.fixPrompt = prompt;
                return prompt;
            },
            applyFix: async () => {
                const output = await options.repairProject({
                    attempt,
                    maxAttempts,
                    prompt: attemptRecord.fixPrompt ?? '',
                    runReport: workingCapture.runReport,
                    analysis: workingCapture.analysis,
                    projectConfig: options.projectConfig,
                    suspectedFailureBucket: remediationPolicy.bucket,
                    remediationPolicy,
                });
                attemptRecord.repairOutput = output;
                return output;
            },
            verifyFix: async () => {
                const verificationCapture = await captureRuntimeState(
                    options.runtimeFactory,
                    options.projectConfig.rootDir,
                    options.enhanceAnalysis,
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
        attemptRecord.failureBucket = workflowResult.status === WorkflowStatus.Failed
            ? deriveFixAttemptFailureBucket(attemptRecord)
            : undefined;
        attempts.push(attemptRecord);

        if (workflowResult.status === WorkflowStatus.Completed) {
            return {
                status: WorkflowStatus.Completed,
                attempts,
                totalDuration: Date.now() - startedAt,
                attemptCount: attempts.length,
                appliedPolicyIds: collectAppliedPolicyIds(attempts),
                automaticActionIds: collectAutomaticActionIds(attempts),
                observedFailureBuckets: collectObservedFailureBuckets(attempts),
                resultLabel: attemptRecord.verificationRunReport?.url ?? 'repaired',
                finalRunReport: attemptRecord.verificationRunReport ?? workingCapture.runReport,
            };
        }
    }

    const lastAttempt = attempts[attempts.length - 1];
    return {
        status: WorkflowStatus.Failed,
        attempts,
        totalDuration: Date.now() - startedAt,
        attemptCount: attempts.length,
        appliedPolicyIds: collectAppliedPolicyIds(attempts),
        automaticActionIds: collectAutomaticActionIds(attempts),
        observedFailureBuckets: collectObservedFailureBuckets(attempts),
        failureBucket: lastAttempt?.failureBucket ?? 'fix_failed',
        resultLabel: lastAttempt?.verificationRunReport?.url ?? `${attempts.length} attempts`,
        finalRunReport: lastAttempt?.verificationRunReport ?? lastAttempt?.initialRunReport,
        error: lastAttempt?.error ?? '达到最大修复尝试次数',
    };
}

async function captureRuntimeState(
    runtimeFactory: () => FixProjectFlowRuntime,
    projectDir: string,
    enhanceAnalysis?: (analysis: ErrorAnalysis, runReport: RunReport) => Promise<ErrorAnalysis> | ErrorAnalysis,
): Promise<RuntimeCapture> {
    const runtime = runtimeFactory();

    try {
        const runReport = await runtime.start(projectDir);
        const normalizedAnalysis = normalizeAnalysis(runReport, runtime.analyzeErrors());
        const analysis = enhanceAnalysis
            ? await enhanceAnalysis(normalizedAnalysis, runReport)
            : normalizedAnalysis;
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
    remediationPolicy: RemediationPolicy;
    previousAttempts: FixProjectFlowAttempt[];
}): string {
    const {
        attempt,
        maxAttempts,
        userRequest,
        runReport,
        analysis,
        remediationPolicy,
        previousAttempts,
    } = input;

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
        ...(analysis.lspDiagnosticsSummary
            ? [
                '',
                'LSP 诊断:',
                analysis.lspDiagnosticsSummary,
            ]
            : []),
        ...(previousAttempts.length > 0
            ? [
                '',
                '上一轮修复记录:',
                ...previousAttempts.map((previousAttempt) => formatPreviousAttempt(previousAttempt)),
            ]
            : []),
        '',
        '修复策略:',
        `- bucket: ${remediationPolicy.bucket}`,
        `- policy: ${remediationPolicy.id}`,
        `- retry_stage: ${remediationPolicy.retryStage}`,
        `- max_attempts: ${remediationPolicy.maxAttempts}`,
        `- 标题: ${remediationPolicy.title}`,
        `- 摘要: ${remediationPolicy.summary}`,
        ...remediationPolicy.instructions.map((instruction) => `- ${instruction}`),
        ...(remediationPolicy.suggestedCommands.length > 0
            ? [
                '',
                '候选命令:',
                ...remediationPolicy.suggestedCommands.map((command) => `- ${command}`),
            ]
            : []),
        '',
        '验证清单:',
        ...remediationPolicy.verification.map((item) => `- ${item}`),
        '',
        '要求:',
        '- 读取相关源文件',
        '- 只修复当前启动或编译问题',
        '- 不要改变原有功能目标',
        '- 修改完成后让系统重新运行验证',
    ].join('\n');
}

function collectAppliedPolicyIds(attempts: FixProjectFlowAttempt[]): string[] {
    const policyIds = attempts.flatMap((attempt) => (
        [
            attempt.automaticActionPolicyId,
            attempt.remediationPolicyId,
        ].filter((policyId): policyId is string => typeof policyId === 'string' && policyId.length > 0)
    ));

    return [...new Set(policyIds)];
}

function collectAutomaticActionIds(attempts: FixProjectFlowAttempt[]): string[] {
    return [...new Set(
        attempts
            .map((attempt) => attempt.automaticActionId)
            .filter((actionId): actionId is string => typeof actionId === 'string' && actionId.length > 0),
    )];
}

function collectObservedFailureBuckets(attempts: FixProjectFlowAttempt[]): string[] {
    const buckets = attempts.flatMap((attempt) => (
        [
            attempt.automaticActionTriggerBucket,
            attempt.suspectedFailureBucket,
        ].filter((bucket): bucket is string => typeof bucket === 'string' && bucket.length > 0)
    ));

    return [...new Set(buckets)];
}

function deriveFixAttemptFailureBucket(attempt: FixProjectFlowAttempt): string {
    const failedStep = findLastFailedStep(attempt.stepResults)?.stepName;
    if (failedStep === 'apply_fix') {
        return 'repair_failed';
    }
    if (failedStep === 'verify_fix') {
        return resolveRuntimeAnalysisFailureBucket(attempt.verificationAnalysis?.errors.map((error) => error.type));
    }
    if (failedStep === 'run_and_detect') {
        return resolveRuntimeErrorsFailureBucket(attempt.initialRunReport.errors.map((error) => error.type));
    }
    return deriveDefaultFailureBucket(attempt.stepResults) ?? 'fix_failed';
}

function resolveRuntimeAnalysisFailureBucket(
    errorTypes: RuntimeErrorType[] | undefined,
): string {
    const runtimeErrorType = errorTypes?.[0];
    switch (runtimeErrorType) {
        case RuntimeErrorType.DependencyMissing:
            return 'verification_dependency_missing';
        case RuntimeErrorType.CompileError:
            return 'verification_compile_error';
        case RuntimeErrorType.PortConflict:
            return 'verification_port_conflict';
        case RuntimeErrorType.ConfigError:
            return 'verification_config_error';
        case RuntimeErrorType.PermissionDenied:
            return 'verification_permission_denied';
        case RuntimeErrorType.RuntimeException:
            return 'verification_runtime_exception';
        default:
            return 'verification_failed';
    }
}

function resolveRuntimeErrorsFailureBucket(
    errorTypes: RuntimeErrorType[],
): string {
    const runtimeErrorType = errorTypes[0];
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

function formatPreviousAttempt(attempt: FixProjectFlowAttempt): string {
    const failedStep = findLastFailedStep(attempt.stepResults)?.stepName;
    const outcome = attempt.workflowStatus === WorkflowStatus.Completed
        ? 'completed'
        : `failed at ${failedStep ?? 'unknown_step'}`;
    const summary = summarizeAttemptOutcome(attempt);

    return `- 第 ${attempt.attempt} 轮: policy=${attempt.remediationPolicyId ?? 'unknown'} bucket=${attempt.suspectedFailureBucket ?? attempt.failureBucket ?? 'unknown'} result=${outcome} summary=${summary}`;
}

function summarizeAttemptOutcome(attempt: FixProjectFlowAttempt): string {
    const candidates = [
        attempt.verificationAnalysis?.summaryForAgent,
        attempt.error,
        attempt.initialAnalysis.summaryForAgent,
    ];

    const summary = candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
        ?? '无摘要';
    return summary.split('\n')[0]?.trim() ?? summary;
}
