export interface GoldenTaskDefinition {
    id: string;
    title: string;
    prompt: string;
    cwd: string;
    expectedAll?: string[];
    expectedAny?: string[];
    forbidden?: string[];
}

export interface GoldenTaskEvaluation {
    ok: boolean;
    matchedAll: string[];
    missingAll: string[];
    matchedAny: string[];
    missingAny: string[];
    matchedForbidden: string[];
}

export interface GoldenTaskMetrics {
    steps?: number;
    toolFailures?: number;
    approvals?: number;
    approvalInterruptions?: number;
    rollbacks?: number;
    humanTakeover?: boolean;
}

export interface GoldenTaskResult extends GoldenTaskEvaluation, GoldenTaskMetrics {
    id: string;
    title: string;
    cwd: string;
    durationMs: number;
    response?: string;
    error?: string;
}

export interface GoldenTaskSummary {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    successRate: number;
    avgDurationMs: number;
    avgSteps: number;
    totalToolFailures: number;
    toolFailureRate: number;
    totalApprovals: number;
    approvalInterruptionRate: number;
    totalRollbacks: number;
    rollbackRate: number;
}

export interface GoldenTaskBatchResult {
    summary: GoldenTaskSummary;
    results: GoldenTaskResult[];
}

export interface GoldenTaskRunner {
    run(task: GoldenTaskDefinition): Promise<{ response: string; metrics?: GoldenTaskMetrics }>;
}

export function evaluateGoldenTaskResponse(
    task: GoldenTaskDefinition,
    response: string,
): GoldenTaskEvaluation {
    const haystack = response.toLowerCase();
    const expectedAll = normalizeNeedles(task.expectedAll);
    const expectedAny = normalizeNeedles(task.expectedAny);
    const forbidden = normalizeNeedles(task.forbidden);

    const matchedAll = expectedAll.filter((needle) => haystack.includes(needle.toLowerCase()));
    const missingAll = expectedAll.filter((needle) => !matchedAll.includes(needle));
    const matchedAny = expectedAny.filter((needle) => haystack.includes(needle.toLowerCase()));
    const missingAny = expectedAny.filter((needle) => !matchedAny.includes(needle));
    const matchedForbidden = forbidden.filter((needle) => haystack.includes(needle.toLowerCase()));
    const anySatisfied = expectedAny.length === 0 || matchedAny.length > 0;

    return {
        ok: missingAll.length === 0 && anySatisfied && matchedForbidden.length === 0,
        matchedAll,
        missingAll,
        matchedAny,
        missingAny,
        matchedForbidden,
    };
}

export async function runGoldenTaskBatch(
    tasks: GoldenTaskDefinition[],
    runner: GoldenTaskRunner,
): Promise<GoldenTaskBatchResult> {
    const results: GoldenTaskResult[] = [];

    for (const task of tasks) {
        const startedAt = Date.now();
        try {
            const { response, metrics } = await runner.run(task);
            const evaluation = evaluateGoldenTaskResponse(task, response);
            results.push({
                id: task.id,
                title: task.title,
                cwd: task.cwd,
                durationMs: Date.now() - startedAt,
                response,
                ...evaluation,
                ...metrics,
            });
        } catch (error) {
            results.push({
                id: task.id,
                title: task.title,
                cwd: task.cwd,
                durationMs: Date.now() - startedAt,
                ok: false,
                matchedAll: [],
                missingAll: normalizeNeedles(task.expectedAll),
                matchedAny: [],
                missingAny: normalizeNeedles(task.expectedAny),
                matchedForbidden: [],
                error: error instanceof Error ? error.message : String(error),
                steps: 0,
                toolFailures: 0,
                approvals: 0,
                approvalInterruptions: 0,
                rollbacks: 0,
                humanTakeover: false,
            });
        }
    }

    const passed = results.filter((result) => result.ok).length;
    const total = results.length;
    const failed = total - passed;
    const totalDurationMs = results.reduce((sum, result) => sum + result.durationMs, 0);
    const totalSteps = results.reduce((sum, result) => sum + (result.steps ?? 0), 0);
    const totalToolFailures = results.reduce((sum, result) => sum + (result.toolFailures ?? 0), 0);
    const totalApprovals = results.reduce((sum, result) => sum + (result.approvals ?? 0), 0);
    const approvalInterruptions = results.reduce((sum, result) => sum + (result.approvalInterruptions ?? 0), 0);
    const totalRollbacks = results.reduce((sum, result) => sum + (result.rollbacks ?? 0), 0);

    return {
        summary: {
            total,
            passed,
            failed,
            passRate: total === 0 ? 0 : passed / total,
            successRate: total === 0 ? 0 : passed / total,
            avgDurationMs: total === 0 ? 0 : totalDurationMs / total,
            avgSteps: total === 0 ? 0 : totalSteps / total,
            totalToolFailures,
            toolFailureRate: total === 0 ? 0 : totalToolFailures / total,
            totalApprovals,
            approvalInterruptionRate: total === 0 ? 0 : approvalInterruptions / total,
            totalRollbacks,
            rollbackRate: total === 0 ? 0 : totalRollbacks / total,
        },
        results,
    };
}

function normalizeNeedles(values: string[] | undefined): string[] {
    return (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean);
}
