export interface AutoFixCheckResult {
    ok: boolean;
    output: string;
}

export interface AutoFixExecutedTool {
    name: string;
    modifiedFiles: string[];
}

export interface AutoFixRunInput {
    executedTools: AutoFixExecutedTool[];
}

export interface AutoFixOutcome {
    triggered: boolean;
    systemMessage?: string;
    disabledReason?: 'max_per_turn_exceeded';
}

export interface AutoFixRunnerOptions {
    runLint: () => Promise<AutoFixCheckResult>;
    runTypeCheck: () => Promise<AutoFixCheckResult>;
    maxPerTurn?: number;
}

export interface AutoFixRunner {
    runForTurn(input: AutoFixRunInput): Promise<AutoFixOutcome>;
    resetTurn(): void;
}

const MODIFYING_TOOLS = new Set(['edit_file', 'write_file', 'apply_patch']);

export function createAutoFixRunner(options: AutoFixRunnerOptions): AutoFixRunner {
    const maxPerTurn = options.maxPerTurn ?? 2;
    let invocations = 0;

    return {
        async runForTurn(input) {
            const modifying = input.executedTools.some(
                (tool) => MODIFYING_TOOLS.has(tool.name) && tool.modifiedFiles.length > 0,
            );
            if (!modifying) {
                return { triggered: false };
            }

            if (invocations >= maxPerTurn) {
                return { triggered: false, disabledReason: 'max_per_turn_exceeded' };
            }
            invocations += 1;

            const [lint, tsc] = await Promise.all([options.runLint(), options.runTypeCheck()]);
            const problems: string[] = [];
            if (!lint.ok) problems.push(`lint:\n${lint.output.trim()}`);
            if (!tsc.ok) problems.push(`type-check:\n${tsc.output.trim()}`);

            if (problems.length === 0) {
                return { triggered: true };
            }

            const systemMessage = [
                'auto-fix detected problems after file modifications:',
                ...problems,
                'Please address the above before the next tool call if they are relevant to your change.',
            ].join('\n\n');
            return { triggered: true, systemMessage };
        },
        resetTurn() {
            invocations = 0;
        },
    };
}
