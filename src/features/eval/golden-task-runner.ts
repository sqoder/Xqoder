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

export interface GoldenTaskResult extends GoldenTaskEvaluation {
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
}

export interface GoldenTaskBatchResult {
    summary: GoldenTaskSummary;
    results: GoldenTaskResult[];
}

export interface GoldenTaskRunner {
    run(task: GoldenTaskDefinition): Promise<{ response: string }>;
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
            const { response } = await runner.run(task);
            const evaluation = evaluateGoldenTaskResponse(task, response);
            results.push({
                id: task.id,
                title: task.title,
                cwd: task.cwd,
                durationMs: Date.now() - startedAt,
                response,
                ...evaluation,
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
            });
        }
    }

    const passed = results.filter((result) => result.ok).length;
    const total = results.length;
    const failed = total - passed;

    return {
        summary: {
            total,
            passed,
            failed,
            passRate: total === 0 ? 0 : passed / total,
        },
        results,
    };
}

function normalizeNeedles(values: string[] | undefined): string[] {
    return (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean);
}
