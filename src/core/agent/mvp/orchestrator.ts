import type { AgentSession } from '../session/session.js';
import type { RollbackStore } from '../tools/rollback-store.js';
import { MvpFailurePatternMemory } from './pattern-memory.js';
import {
    applyMvpRecoveryDecision,
    renderMvpRecoveryMessage,
    resolveMvpRecoveryDecision,
} from './recovery-manager.js';
import { loadMvpRuntimeConfig } from './runtime-config.js';
import {
    createMvpBaselineCheck,
    createMvpStopCheck,
    evaluateMvpStopConditions,
    formatMvpStopEvaluationMessage,
} from './stop-condition.js';
import { formatMvpVerificationMessage, runMvpVerification } from './verifier.js';
import type {
    AgentRuntimeProfile,
    MvpBaselineSignal,
    MvpFailureClassification,
    MvpRecoveryAction,
    MvpRuntimeConfig,
    MvpStopEvaluationResult,
    MvpTaskType,
    MvpVerificationResult,
} from './types.js';

export interface MvpRuntimeControllerOptions {
    userGoal: string;
    projectRoot: string;
    contextPaths?: string[];
    shell?: { path?: string; args?: string[] };
    session: AgentSession;
    rollbackStore?: RollbackStore;
    runtimeProfile?: AgentRuntimeProfile;
    runtimeConfig?: MvpRuntimeConfig;
}

interface PendingRecoveryRecord {
    taskType: MvpTaskType;
    errorSignature: string;
    errorCategory: MvpFailureClassification;
    strategy: MvpRecoveryAction;
}

export class MvpRuntimeController {
    private readonly runtimeConfig: MvpRuntimeConfig;
    private readonly startedAt = Date.now();
    private readonly failurePatternMemory: MvpFailurePatternMemory;
    private lastVerifiedFileChangeCount = 0;
    private completionBlockReason?: string;
    private lastFailureDigest?: string;
    private repeatedFailureCount = 0;
    private retriedFailureDigests = new Set<string>();
    private latestTaskType: MvpTaskType = 'question';
    private latestStopEvaluation?: MvpStopEvaluationResult;
    private latestVerification?: MvpVerificationResult;
    private latestBaselineSignal?: MvpBaselineSignal;
    private pendingRecovery?: PendingRecoveryRecord;
    private loopCount = 0;

    constructor(private readonly options: MvpRuntimeControllerOptions) {
        this.runtimeConfig = options.runtimeConfig ?? loadMvpRuntimeConfig(options.projectRoot);
        this.failurePatternMemory = new MvpFailurePatternMemory(options.projectRoot);
    }

    beginTurn(taskType: MvpTaskType): void {
        this.loopCount += 1;
        this.latestBaselineSignal = readLatestBaselineSignal(this.options.session);
        this.latestTaskType = taskType;
    }

    async runPostToolVerification(): Promise<void> {
        this.latestBaselineSignal = readLatestBaselineSignal(this.options.session);
        const pendingWrites = this.getPendingSuccessfulWrites();

        if (pendingWrites.length === 0) {
            if (this.latestBaselineSignal?.status === 'failed') {
                this.completionBlockReason = this.latestBaselineSignal.summary;
            }
            return;
        }

        let verificationState = await this.verifyCurrentState();
        this.recordVerificationState(verificationState);
        this.options.session.addMessage({
            role: 'system',
            content: renderVerificationStateMessage(verificationState),
        });
        this.lastVerifiedFileChangeCount = this.options.session.getFileChanges().length;

        if (verificationState.verification.ok) {
            this.flushPendingRecovery('success');

            if (verificationState.stopEvaluation.reason === 'all_met') {
                this.clearCompletionBlock();
                return;
            }

            this.completionBlockReason = verificationState.stopEvaluation.failedConditions.length > 0
                ? `Stop conditions are not satisfied yet: ${verificationState.stopEvaluation.failedConditions.join(', ')}`
                : `Stop evaluator reason: ${verificationState.stopEvaluation.reason}`;
            return;
        }

        this.flushPendingRecovery('failure');
        this.trackFailureDigest(verificationState.verification.digest);
        const latestRollbackPointId = getLatestRollbackPointId(pendingWrites);
        const errorSignature = buildFailureSignature(verificationState.verification);
        let recovery = resolveMvpRecoveryDecision({
            verification: verificationState.verification,
            repeatedFailureCount: this.repeatedFailureCount,
            latestRollbackPointId,
            rememberedPattern: this.failurePatternMemory.query(errorSignature, this.latestTaskType),
        });

        if (recovery.action === 'retry' && !this.retriedFailureDigests.has(verificationState.verification.digest)) {
            this.retriedFailureDigests.add(verificationState.verification.digest);
            verificationState = await this.verifyCurrentState();
            this.recordVerificationState(verificationState);
            this.options.session.addMessage({
                role: 'system',
                content: `Recovery retry executed.\n${renderVerificationStateMessage(verificationState)}`,
            });

            if (verificationState.verification.ok) {
                this.failurePatternMemory.record({
                    taskType: this.latestTaskType,
                    errorSignature,
                    errorCategory: recovery.classification,
                    strategy: 'retry',
                    outcome: 'success',
                });
                this.clearCompletionBlock();
                return;
            }

            this.failurePatternMemory.record({
                taskType: this.latestTaskType,
                errorSignature,
                errorCategory: recovery.classification,
                strategy: 'retry',
                outcome: 'failure',
            });
            this.trackFailureDigest(verificationState.verification.digest);
            recovery = resolveMvpRecoveryDecision({
                verification: verificationState.verification,
                repeatedFailureCount: this.repeatedFailureCount,
                latestRollbackPointId,
                rememberedPattern: this.failurePatternMemory.query(errorSignature, this.latestTaskType),
            });
        }

        recovery = applyMvpRecoveryDecision(recovery, this.options.rollbackStore);
        const recoveryMessage = renderMvpRecoveryMessage(recovery);
        this.options.session.addMessage({
            role: 'system',
            content: recoveryMessage,
        });
        this.pendingRecovery = {
            taskType: this.latestTaskType,
            errorSignature,
            errorCategory: recovery.classification,
            strategy: recovery.action,
        };
        this.completionBlockReason = `${verificationState.verification.summary}\n${recoveryMessage}`;
    }

    getCompletionBlocker(): string | undefined {
        if (this.latestTaskType === 'question') {
            return this.completionBlockReason
                ? [
                    'Do not finish yet.',
                    'The latest write did not pass the runtime verifier.',
                    this.completionBlockReason,
                    'Continue working until verification passes.',
                ].join('\n')
                : undefined;
        }

        if (this.completionBlockReason) {
            return [
                'Do not finish yet.',
                'The latest write did not pass the runtime verifier.',
                this.completionBlockReason,
                'Continue working until verification passes.',
            ].join('\n');
        }

        if (!this.latestStopEvaluation) {
            return [
                'Do not finish yet.',
                'Stop conditions have not been evaluated yet.',
                'Execute the required tools, produce a verified result, then let the stop evaluator approve completion.',
            ].join('\n');
        }

        if (this.latestStopEvaluation.reason !== 'all_met') {
            return [
                'Do not finish yet.',
                `Stop evaluator reason: ${this.latestStopEvaluation.reason}.`,
                this.latestStopEvaluation.failedConditions.length > 0
                    ? `Unmet conditions: ${this.latestStopEvaluation.failedConditions.join(', ')}`
                    : 'A configured stop condition is still blocking completion.',
            ].join('\n');
        }

        return undefined;
    }

    hasPendingSuccessfulWrites(): boolean {
        return this.getPendingSuccessfulWrites().length > 0;
    }

    getLoopCount(): number {
        return this.loopCount;
    }

    getStartedAtMs(): number {
        return this.startedAt;
    }

    isCompletionReady(): boolean {
        return this.latestTaskType !== 'question' && this.latestStopEvaluation?.reason === 'all_met';
    }

    private async verifyCurrentState(): Promise<{
        verification: MvpVerificationResult;
        stopEvaluation: MvpStopEvaluationResult;
    }> {
        const verification = await runMvpVerification({
            projectRoot: this.options.projectRoot,
            shell: this.options.shell,
            distill: this.runtimeConfig.distillVerifier,
        });
        const checks = verification.checks.filter((check) => check.name !== 'baseline' && check.name !== 'stop');
        checks.unshift(createMvpBaselineCheck(this.latestBaselineSignal));

        const verificationWithBaseline: MvpVerificationResult = {
            ...verification,
            checks,
        };
        const stopEvaluation = evaluateMvpStopConditions({
            config: this.runtimeConfig.stopConditions,
            verification: verificationWithBaseline,
            loopCount: this.loopCount,
            startedAt: this.startedAt,
            baselineSignal: this.latestBaselineSignal,
            previousVerification: this.latestVerification,
        });

        return {
            verification: {
                ...verificationWithBaseline,
                checks: [
                    ...verificationWithBaseline.checks,
                    createMvpStopCheck(stopEvaluation),
                ],
            },
            stopEvaluation,
        };
    }

    private getPendingSuccessfulWrites() {
        return this.options.session.getFileChanges()
            .slice(this.lastVerifiedFileChangeCount)
            .filter((entry) => entry.success);
    }

    private clearCompletionBlock(): void {
        this.completionBlockReason = undefined;
        this.lastFailureDigest = undefined;
        this.repeatedFailureCount = 0;
    }

    private trackFailureDigest(digest: string): void {
        if (this.lastFailureDigest === digest) {
            this.repeatedFailureCount += 1;
            return;
        }

        this.lastFailureDigest = digest;
        this.repeatedFailureCount = 0;
    }

    private recordVerificationState(input: {
        verification: MvpVerificationResult;
        stopEvaluation: MvpStopEvaluationResult;
    }): void {
        this.latestVerification = input.verification;
        this.latestStopEvaluation = input.stopEvaluation;
    }

    private flushPendingRecovery(outcome: 'success' | 'failure'): void {
        if (!this.pendingRecovery) {
            return;
        }

        this.failurePatternMemory.record({
            taskType: this.pendingRecovery.taskType,
            errorSignature: this.pendingRecovery.errorSignature,
            errorCategory: this.pendingRecovery.errorCategory,
            strategy: this.pendingRecovery.strategy,
            outcome,
        });
        this.pendingRecovery = undefined;
    }
}

function renderVerificationStateMessage(input: {
    verification: MvpVerificationResult;
    stopEvaluation: MvpStopEvaluationResult;
}): string {
    return [
        formatMvpVerificationMessage(input.verification),
        formatMvpStopEvaluationMessage(input.stopEvaluation),
    ].join('\n');
}

function getLatestRollbackPointId(
    fileChanges: Array<{ rollbackPointId?: string }>,
): string | undefined {
    const reversed = [...fileChanges].reverse();
    return reversed.find((entry) => typeof entry.rollbackPointId === 'string')?.rollbackPointId;
}

function readLatestBaselineSignal(session: AgentSession): MvpBaselineSignal | undefined {
    const latestWrite = [...session.getToolHistory()]
        .reverse()
        .find((entry) => entry.name === 'write_file' && entry.outputPreview.includes('Baseline check:'));
    if (!latestWrite) {
        return undefined;
    }

    const firstLine = latestWrite.outputPreview
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith('Baseline check:'));
    if (!firstLine) {
        return undefined;
    }

    const status = firstLine.includes('failed')
        ? 'failed'
        : firstLine.includes('passed')
            ? 'passed'
            : 'skipped';
    const regressions = firstLine.includes(':')
        ? firstLine.split(':').slice(2).join(':').split(',').map((entry) => entry.trim()).filter(Boolean)
        : [];

    return {
        status,
        summary: firstLine,
        regressions,
    };
}

function buildFailureSignature(verification: MvpVerificationResult): string {
    return verification.checks
        .filter((check) => check.status === 'failed' && check.name !== 'output' && check.name !== 'stop')
        .map((check) => {
            const locationPart = check.locations && check.locations.length > 0
                ? ` @ ${check.locations
                    .slice(0, 2)
                    .map((location) => `${location.file}:${location.line}`)
                    .join(', ')}`
                : '';
            return `${check.name}:${check.summary}${locationPart}`;
        })
        .join(' | ');
}
