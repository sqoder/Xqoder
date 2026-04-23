import type { LLMMessage, TaskMode } from '@xqoder/shared';
import type { AgentSession, AgentToolExecution } from '@xqoder/agent';
import {
    isWriteLikeTool,
    shouldTriggerVerifierAfterTool,
} from '../../domain/permissions/tool-policy.js';
import type { ToolExecutionResult } from './tool-orchestrator.js';

export interface VerificationGateRuntime {
    runPostToolVerification(): Promise<void>;
    getCompletionBlocker(): string | undefined;
}

export interface VerificationGateSignal {
    ok: boolean;
    blocked: boolean;
    summary: string;
    messages: string[];
}

export interface VerificationGateResult {
    invoked: boolean;
    triggered: boolean;
    blocked: boolean;
    appendedMessages: LLMMessage[];
    completionBlocker?: string;
    signal?: VerificationGateSignal;
    runtimeInvoked?: boolean;
}

export interface VerificationPlan {
    runtimeAvailable: boolean;
    taskMode?: TaskMode;
    verificationRequired: boolean;
    shouldEvaluate: boolean;
    shouldInvokeRuntime: boolean;
    batchHasWriteTrigger: boolean;
    batchHasVerificationEvidence: boolean;
    batchHasReproductionEvidence: boolean;
    hasLatestWrite: boolean;
    hasReproductionBeforeLatestWrite: boolean;
    hasPassingVerificationAfterLatestWrite: boolean;
}

export interface VerificationRunResult {
    runtimeInvoked: boolean;
    runtimeBlocked: boolean;
    runtimePassed: boolean;
    runtimeBlocker?: string;
}

export interface VerificationEvaluation {
    blocked: boolean;
    completionBlocker?: string;
    recoveryMessages: string[];
}

const FAILURE_SIGNAL_PATTERN = /(?:error|fail(?:ed|ing)?|exception|typeerror|referenceerror|syntaxerror|stack trace|traceback|panic|报错|异常|失败|堆栈)/i;
const VERIFICATION_COMMAND_PATTERN = /(?:\btest\b|jest|vitest|pytest|mocha|ava|eslint|\blint\b|typecheck|\btsc\b|\bbuild\b|\bcheck\b|\bverify\b|diagnostic)/i;
const DIAGNOSTIC_PASS_PATTERN = /(?:no diagnostics|0 errors?|0 problems?|clean|passed|success|ok|no issues)/i;

export class VerificationPlanner {
    static plan(input: {
        session: AgentSession;
        runtime?: VerificationGateRuntime;
        executions?: ToolExecutionResult[];
        taskMode?: TaskMode;
    }): VerificationPlan {
        const toolHistory = input.session.getToolHistory();
        const latestWriteIndex = findLatestSuccessfulWriteIndex(toolHistory);
        const batchExecutions = input.executions ?? [];
        const batchSignals = batchExecutions.map(createBatchSignal);
        const verificationRequired = requiresVerificationBarrier({
            taskMode: input.taskMode,
            runtime: input.runtime,
            hasLatestWrite: latestWriteIndex >= 0,
        });
        const batchHasWriteTrigger = batchExecutions.some(isVerificationTriggerExecution);
        const batchHasVerificationEvidence = latestWriteIndex >= 0
            && batchSignals.some((signal) => isPassingVerificationEvidence(signal));
        const batchHasReproductionEvidence = latestWriteIndex >= 0
            && batchSignals.some((signal) => isDebugFixReproductionEvidence(signal));
        const hasPassingVerificationAfterLatestWrite = latestWriteIndex >= 0
            ? toolHistory.slice(latestWriteIndex + 1).some(isPassingVerificationEvidence)
            : false;
        const hasPendingLatestWrite = latestWriteIndex >= 0 && !hasPassingVerificationAfterLatestWrite;
        const batchPresent = batchExecutions.length > 0;
        const batchRequestsEvaluation = batchHasWriteTrigger
            || batchHasVerificationEvidence
            || (input.taskMode === 'debug_fix' && batchHasReproductionEvidence);

        return {
            runtimeAvailable: Boolean(input.runtime),
            taskMode: input.taskMode,
            verificationRequired,
            shouldEvaluate: verificationRequired && (
                batchRequestsEvaluation
                || (hasPendingLatestWrite && !batchPresent)
            ),
            shouldInvokeRuntime: verificationRequired
                && Boolean(input.runtime)
                && batchHasWriteTrigger,
            batchHasWriteTrigger,
            batchHasVerificationEvidence,
            batchHasReproductionEvidence,
            hasLatestWrite: latestWriteIndex >= 0,
            hasReproductionBeforeLatestWrite: latestWriteIndex >= 0
                ? toolHistory.slice(0, latestWriteIndex).some(isDebugFixReproductionEvidence)
                : false,
            hasPassingVerificationAfterLatestWrite,
        };
    }
}

export class VerificationRunner {
    static async run(input: {
        runtime?: VerificationGateRuntime;
        shouldInvokeRuntime: boolean;
    }): Promise<VerificationRunResult> {
        if (!input.runtime || !input.shouldInvokeRuntime) {
            return {
                runtimeInvoked: false,
                runtimeBlocked: false,
                runtimePassed: false,
            };
        }

        await input.runtime.runPostToolVerification();
        const runtimeBlocker = normalizeBlocker(input.runtime.getCompletionBlocker());
        const runtimeBlocked = Boolean(runtimeBlocker);

        return {
            runtimeInvoked: true,
            runtimeBlocked,
            runtimePassed: !runtimeBlocked,
            ...(runtimeBlocker ? { runtimeBlocker } : {}),
        };
    }
}

export class VerificationEvaluator {
    static evaluate(input: {
        plan: VerificationPlan;
        run: VerificationRunResult;
    }): VerificationEvaluation {
        const recoveryMessages: string[] = [];
        const blockers: string[] = [];
        const latestWriteVerified = !input.plan.hasLatestWrite
            || input.run.runtimePassed
            || input.plan.hasPassingVerificationAfterLatestWrite;

        if (!latestWriteVerified) {
            recoveryMessages.push([
                'Do not finish yet.',
                'The latest file write still needs a successful verification pass.',
                'Run verification after the write, then continue only after it passes.',
            ].join('\n'));
        }

        if (input.plan.taskMode === 'debug_fix' && input.plan.hasLatestWrite && !input.plan.hasReproductionBeforeLatestWrite) {
            recoveryMessages.push([
                'Do not finish yet.',
                'Task mode is debug_fix, so the latest fix must follow reproduce -> fix -> verify.',
                'Reproduce the failure before the next write, then apply the fix again, then verify it.',
            ].join('\n'));
        }

        if (input.run.runtimeBlocker) {
            blockers.push(input.run.runtimeBlocker);
        }

        blockers.push(...recoveryMessages);

        return {
            blocked: blockers.length > 0,
            ...(blockers.length > 0
                ? { completionBlocker: blockers.join('\n\n') }
                : {}),
            recoveryMessages,
        };
    }
}

export class RecoveryController {
    static apply(input: {
        session: AgentSession;
        evaluation: VerificationEvaluation;
        run: VerificationRunResult;
        runtimeMessages: LLMMessage[];
        syntheticMessages: string[];
    }): void {
        const seenMessages = new Set(
            [
                ...input.runtimeMessages.map((message) => String(message.content ?? '')),
                ...input.syntheticMessages,
            ]
                .map((message) => normalizeBlocker(message))
                .filter((message): message is string => Boolean(message)),
        );

        for (const message of input.evaluation.recoveryMessages) {
            const normalized = normalizeBlocker(message);
            if (!normalized || seenMessages.has(normalized)) {
                continue;
            }
            input.session.addMessage({
                role: 'system',
                content: message,
            });
            seenMessages.add(normalized);
        }

        if (!input.evaluation.blocked || input.runtimeMessages.length > 0 || !input.run.runtimeBlocker) {
            return;
        }

        const normalizedRuntimeBlocker = normalizeBlocker(input.run.runtimeBlocker);
        if (!normalizedRuntimeBlocker || seenMessages.has(normalizedRuntimeBlocker)) {
            return;
        }

        input.session.addMessage({
            role: 'system',
            content: input.run.runtimeBlocker,
        });
    }
}

export async function runVerificationGate(input: {
    session: AgentSession;
    runtime?: VerificationGateRuntime;
    executions?: ToolExecutionResult[];
    taskMode?: TaskMode;
}): Promise<VerificationGateResult> {
    const plan = VerificationPlanner.plan(input);
    if (!plan.shouldEvaluate) {
        return createNoopVerificationGateResult();
    }

    const beforeMessages = input.session.getMessages();
    const run = await VerificationRunner.run({
        runtime: input.runtime,
        shouldInvokeRuntime: plan.shouldInvokeRuntime,
    });
    const runtimeMessages = input.session.getMessages().slice(beforeMessages.length);
    const evaluation = VerificationEvaluator.evaluate({
        plan,
        run,
    });
    const syntheticMessages = createSyntheticVerificationMessages(plan, run, evaluation);
    for (const message of syntheticMessages) {
        input.session.addMessage({
            role: 'system',
            content: message,
        });
    }
    RecoveryController.apply({
        session: input.session,
        evaluation,
        run,
        runtimeMessages,
        syntheticMessages,
    });
    const afterMessages = input.session.getMessages();
    const appendedMessages = afterMessages.slice(beforeMessages.length);
    const signal = buildVerificationSignal({
        evaluation,
        appendedMessages,
    });

    if (signal) {
        input.session.recordVerification({
            ok: signal.ok,
            blocked: signal.blocked,
            summary: signal.summary,
            messages: signal.messages,
        });
    }

    return {
        invoked: true,
        triggered: Boolean(signal),
        blocked: evaluation.blocked,
        appendedMessages,
        ...(evaluation.completionBlocker
            ? { completionBlocker: evaluation.completionBlocker }
            : {}),
        ...(signal ? { signal } : {}),
        ...(run.runtimeInvoked ? { runtimeInvoked: true } : {}),
    };
}

export function createNoopVerificationGateResult(): VerificationGateResult {
    return {
        invoked: false,
        triggered: false,
        blocked: false,
        appendedMessages: [],
    };
}

function requiresVerificationBarrier(input: {
    taskMode?: TaskMode;
    runtime?: VerificationGateRuntime;
    hasLatestWrite: boolean;
}): boolean {
    if (input.taskMode === 'engineering_edit' || input.taskMode === 'debug_fix') {
        return true;
    }

    // Compatibility fallback while older seams still call the gate without a task mode.
    return Boolean(input.runtime) || input.hasLatestWrite;
}

function createSyntheticVerificationMessages(
    plan: VerificationPlan,
    run: VerificationRunResult,
    evaluation: VerificationEvaluation,
): string[] {
    if (evaluation.blocked || run.runtimeInvoked || !plan.hasLatestWrite || !plan.batchHasVerificationEvidence) {
        return [];
    }

    return ['Verification passed via tool evidence.'];
}

function buildVerificationSignal(input: {
    evaluation: VerificationEvaluation;
    appendedMessages: LLMMessage[];
}): VerificationGateSignal | undefined {
    const messages = input.appendedMessages
        .map((message) => String(message.content ?? '').replace(/\s+/g, ' ').trim())
        .filter((content) => content.length > 0);

    if (messages.length === 0 && !input.evaluation.blocked) {
        return undefined;
    }

    const summary = messages.length > 0
        ? messages.join(' | ')
        : input.evaluation.completionBlocker?.replace(/\s+/g, ' ').trim()
            ?? 'Verification blocked completion';

    return {
        ok: !input.evaluation.blocked,
        blocked: input.evaluation.blocked,
        summary,
        messages: messages.length > 0 ? messages : [summary],
    };
}

function findLatestSuccessfulWriteIndex(toolHistory: AgentToolExecution[]): number {
    return findLastIndex(toolHistory, (entry) => entry.success && isWriteLikeTool(entry.name));
}

function createBatchSignal(execution: ToolExecutionResult): AgentToolExecution {
    if (execution.toolHistoryEntry) {
        return execution.toolHistoryEntry;
    }

    return {
        id: execution.id,
        name: execution.name,
        args: execution.args,
        success: execution.ok,
        outputPreview: execution.outputForUser,
        ...(execution.ok ? {} : { error: execution.outputForUser }),
        startedAt: new Date(0),
        completedAt: new Date(0),
    };
}

function readToolSignal(entry: Pick<AgentToolExecution, 'args' | 'outputPreview' | 'error'>): string {
    const command = typeof entry.args?.['command'] === 'string' ? entry.args.command : '';
    return [command, entry.outputPreview, entry.error].filter(Boolean).join('\n');
}

function findLastIndex<T>(items: T[], predicate: (item: T, index: number) => boolean): number {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        if (predicate(items[index]!, index)) {
            return index;
        }
    }

    return -1;
}

function normalizeBlocker(value: string | undefined): string | undefined {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : undefined;
}

function isPassingVerificationEvidence(signal: AgentToolExecution): boolean {
    if (signal.name === 'diagnostics') {
        return signal.success && DIAGNOSTIC_PASS_PATTERN.test(readToolSignal(signal));
    }

    if (signal.name !== 'run_command' && signal.name !== 'run_shell') {
        return false;
    }

    if (!signal.success) {
        return false;
    }

    const combined = readToolSignal(signal);
    return VERIFICATION_COMMAND_PATTERN.test(combined)
        && !FAILURE_SIGNAL_PATTERN.test(combined);
}

function isDebugFixReproductionEvidence(signal: AgentToolExecution): boolean {
    if (signal.name === 'diagnostics') {
        return signal.success || Boolean(normalizeBlocker(signal.outputPreview)) || Boolean(normalizeBlocker(signal.error));
    }

    if (signal.name !== 'run_command' && signal.name !== 'run_shell') {
        return false;
    }

    if (!signal.success) {
        return true;
    }

    return FAILURE_SIGNAL_PATTERN.test(readToolSignal(signal));
}

function isVerificationTriggerExecution(execution: ToolExecutionResult): boolean {
    return execution.fileChanges.some((change) => change.success)
        || (execution.ok && shouldTriggerVerifierAfterTool(execution.name));
}
