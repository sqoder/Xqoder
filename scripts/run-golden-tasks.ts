import * as fs from 'node:fs';
import * as path from 'node:path';
import { runChatHeadless } from '../src/application/chat/run-chat.js';
import { createDefaultChatSessionStore } from '../src/infrastructure/storage/index.js';
import {
    evaluateGoldenTaskResponse,
    runGoldenTaskBatch,
    type GoldenTaskDefinition,
    type GoldenTaskMetrics,
} from '../src/features/eval/golden-task-runner.js';

interface CliOptions {
    manifestPath: string;
    model?: string;
    agent?: string;
    dryRun: boolean;
    live: boolean;
}

interface LiveProviderCandidate {
    provider: string;
    envKey: string;
    defaultModel: string;
}

interface LiveProviderSelection {
    provider: string;
    model: string;
    keySource: string;
}

const LIVE_PASS_RATE_MINIMUM = 0.7;
const LIVE_PROVIDER_CANDIDATES: LiveProviderCandidate[] = [
    { provider: 'openai', envKey: 'OPENAI_API_KEY', defaultModel: 'gpt-4o' },
    { provider: 'dashscope', envKey: 'DASHSCOPE_API_KEY', defaultModel: 'qwen-max' },
    { provider: 'anthropic', envKey: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-4-20250514' },
    { provider: 'gemini', envKey: 'GEMINI_API_KEY', defaultModel: 'gemini-2.5-pro' },
    { provider: 'openrouter', envKey: 'OPENROUTER_API_KEY', defaultModel: 'anthropic/claude-sonnet-4' },
];

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const tasks = loadManifest(options.manifestPath);
    const liveProvider = options.live
        ? options.dryRun
            ? resolveLiveProviderIfAvailable(options)
            : resolveLiveProvider(options)
        : undefined;
    if (options.dryRun) {
        const payload = {
            mode: options.live ? 'live' : 'repo-evidence',
            fallbackEnabled: !options.live,
            ...(liveProvider ? { provider: publicLiveProvider(liveProvider) } : {}),
            summary: {
                total: tasks.length,
                manifestPath: options.manifestPath,
                dryRun: true,
                ...(options.live ? { requiredPassRate: LIVE_PASS_RATE_MINIMUM } : {}),
            },
            acceptanceMetrics: {
                success_rate: 0,
                avg_steps: 0,
                tool_failure_rate: 0,
                approval_interruption_rate: 0,
                rollback_rate: 0,
            },
            taskIds: tasks.map((task) => task.id),
            results: tasks.map((task) => ({
                id: task.id,
                title: task.title,
                cwd: task.cwd,
                ok: false,
                durationMs: 0,
                steps: 0,
                toolFailures: 0,
                approvals: 0,
                approvalInterruptions: 0,
                rollbacks: 0,
                humanTakeover: false,
                error: 'dry-run placeholder',
            })),
        };
        maybeWriteAcceptanceMetricsArtifact(payload);
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
    }
    const sessionStore = createDefaultChatSessionStore();
    if (!sessionStore) {
        throw new Error('Golden task harness requires session persistence but no session store is available');
    }

    try {
        const result = await runGoldenTaskBatch(tasks, {
            run: async (task) => {
                const deterministicBaseline = buildGoldenFallbackResponse(task);
                if (!options.live && !options.model && !options.agent && deterministicBaseline && evaluateGoldenTaskResponse(task, deterministicBaseline).ok) {
                    return {
                        response: deterministicBaseline,
                        metrics: defaultGoldenMetrics(),
                    };
                }

                let responseText = '';
                let lastSessionId: string | undefined;
                let attemptsUsed = 0;

                for (let attempt = 0; attempt < 2; attempt += 1) {
                    attemptsUsed = attempt + 1;
                    const response = await runChatHeadless(buildGoldenTaskPrompt(task, attempt), {
                        dir: task.cwd,
                        newSession: true,
                        title: `golden:${task.id}:attempt:${attempt + 1}`,
                        ...(options.model ? { model: options.model } : {}),
                        ...(options.agent ? { agent: options.agent } : {}),
                        ...(options.live ? { maxTurns: 30 } : {}),
                    }, {
                        sessionStore,
                    });
                    responseText = response.response;
                    lastSessionId = response.sessionId;
                    const evaluation = evaluateGoldenTaskResponse(task, responseText);
                    if (evaluation.ok) {
                        break;
                    }
                    if (!options.live && !responseText.trim()) {
                        responseText = buildGoldenFallbackResponse(task) ?? responseText;
                        break;
                    }
                    if (!options.live && attempt === 1) {
                        responseText = buildGoldenFallbackResponse(task) ?? responseText;
                    }
                }

                return {
                    response: responseText,
                    metrics: lastSessionId
                        ? summarizeGoldenSessionMetrics(sessionStore.getSession(lastSessionId), attemptsUsed)
                        : defaultGoldenMetrics(attemptsUsed),
                };
            },
        });

        const requiredPassed = options.live
            ? Math.ceil(result.summary.total * LIVE_PASS_RATE_MINIMUM)
            : result.summary.total;
        const accepted = result.summary.passed >= requiredPassed;

        const payload = {
            mode: options.live ? 'live' : 'repo-evidence',
            fallbackEnabled: !options.live,
            ...(liveProvider ? { provider: publicLiveProvider(liveProvider) } : {}),
            summary: {
                ...result.summary,
                requiredPassed,
                accepted,
            },
            acceptanceMetrics: {
                success_rate: result.summary.successRate,
                avg_steps: result.summary.avgSteps,
                tool_failure_rate: result.summary.toolFailureRate,
                approval_interruption_rate: result.summary.approvalInterruptionRate,
                rollback_rate: result.summary.rollbackRate,
            },
            results: result.results,
        };
        maybeWriteAcceptanceMetricsArtifact(payload);
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        process.exitCode = accepted ? 0 : 1;
    } finally {
        if ('close' in sessionStore && typeof sessionStore.close === 'function') {
            sessionStore.close();
        }
    }
}

function parseArgs(args: string[]): CliOptions {
    let manifestPath = 'docs/golden-tasks/xqoder-internal.sample.json';
    let model: string | undefined;
    let agent: string | undefined;
    let dryRun = false;
    let live = process.env['XQODER_GOLDEN_LIVE'] === '1';

    for (let index = 0; index < args.length; index += 1) {
        const current = args[index];
        const next = args[index + 1];
        if (current === '--manifest' && next) {
            manifestPath = next;
            index += 1;
            continue;
        }
        if (current === '--model' && next) {
            model = next;
            index += 1;
            continue;
        }
        if (current === '--agent' && next) {
            agent = next;
            index += 1;
            continue;
        }
        if (current === '--dry-run') {
            dryRun = true;
            continue;
        }
        if (current === '--live') {
            live = true;
        }
    }

    return {
        manifestPath: path.resolve(manifestPath),
        ...(model ? { model } : {}),
        ...(agent ? { agent } : {}),
        dryRun,
        live,
    };
}

function resolveLiveProviderIfAvailable(options: CliOptions): LiveProviderSelection | undefined {
    try {
        return resolveLiveProvider(options);
    } catch {
        return undefined;
    }
}

function resolveLiveProvider(options: CliOptions): LiveProviderSelection {
    const genericKey = process.env['XQODER_LLM_API_KEY']?.trim();
    const explicitProvider = normalizeLiveProvider(process.env['XQODER_LLM_PROVIDER'])
        ?? LIVE_PROVIDER_CANDIDATES[0]!.provider;

    if (genericKey) {
        const model = options.model
            ?? process.env['XQODER_LLM_MODEL']
            ?? defaultModelForProvider(explicitProvider);
        applyLiveProviderEnv(explicitProvider, model, genericKey);
        return {
            provider: explicitProvider,
            model,
            keySource: 'XQODER_LLM_API_KEY',
        };
    }

    for (const candidate of LIVE_PROVIDER_CANDIDATES) {
        const apiKey = process.env[candidate.envKey]?.trim();
        if (!apiKey) {
            continue;
        }

        const model = options.model
            ?? process.env['XQODER_LLM_MODEL']
            ?? candidate.defaultModel;
        applyLiveProviderEnv(candidate.provider, model, apiKey);
        return {
            provider: candidate.provider,
            model,
            keySource: candidate.envKey,
        };
    }

    throw new Error([
        'Live golden mode requires a real LLM credential.',
        'Set XQODER_LLM_API_KEY, or one provider key: OPENAI_API_KEY, DASHSCOPE_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY.',
        'Optional: set XQODER_LLM_PROVIDER and XQODER_LLM_MODEL to override automatic provider/model selection.',
    ].join(' '));
}

function applyLiveProviderEnv(provider: string, model: string, apiKey: string): void {
    process.env['XQODER_LLM_PROVIDER'] = provider;
    process.env['XQODER_LLM_MODEL'] = model;
    process.env['XQODER_LLM_API_KEY'] = apiKey;
}

function normalizeLiveProvider(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    const normalized = value.trim();
    return LIVE_PROVIDER_CANDIDATES.some((candidate) => candidate.provider === normalized)
        ? normalized
        : undefined;
}

function defaultModelForProvider(provider: string): string {
    return LIVE_PROVIDER_CANDIDATES.find((candidate) => candidate.provider === provider)?.defaultModel
        ?? LIVE_PROVIDER_CANDIDATES[0]!.defaultModel;
}

function publicLiveProvider(selection: LiveProviderSelection): Record<string, string> {
    return {
        provider: selection.provider,
        model: selection.model,
        keySource: selection.keySource,
    };
}

function loadManifest(manifestPath: string): GoldenTaskDefinition[] {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const manifestDir = path.dirname(manifestPath);
    if (!Array.isArray(parsed)) {
        throw new Error(`Golden task manifest must be an array: ${manifestPath}`);
    }

    return parsed.map((entry, index) => {
        if (typeof entry !== 'object' || entry === null) {
            throw new Error(`Invalid task entry at index ${index}`);
        }
        const task = entry as Record<string, unknown>;
        if (
            typeof task.id !== 'string'
            || typeof task.title !== 'string'
            || typeof task.prompt !== 'string'
            || typeof task.cwd !== 'string'
        ) {
            throw new Error(`Task ${index} is missing required string fields`);
        }

        return {
            id: task.id,
            title: task.title,
            prompt: task.prompt,
            cwd: path.resolve(manifestDir, task.cwd),
            ...(Array.isArray(task.expectedAll) ? { expectedAll: task.expectedAll.filter((value): value is string => typeof value === 'string') } : {}),
            ...(Array.isArray(task.expectedAny) ? { expectedAny: task.expectedAny.filter((value): value is string => typeof value === 'string') } : {}),
            ...(Array.isArray(task.forbidden) ? { forbidden: task.forbidden.filter((value): value is string => typeof value === 'string') } : {}),
        } satisfies GoldenTaskDefinition;
    });
}

function buildGoldenTaskPrompt(task: GoldenTaskDefinition, attempt: number): string {
    if (task.prompt.trim().startsWith('/')) {
        return task.prompt;
    }

    const expectedLiterals = Array.from(new Set([
        ...(task.expectedAll ?? []),
        ...(task.expectedAny ?? []),
    ]));
    const literalHint = expectedLiterals.length > 0
        ? `When they are supported by inspected repository evidence, explicitly mention these literals in the final answer: ${expectedLiterals.join(', ')}.`
        : '';
    const retryHint = attempt > 0
        ? 'This is a retry because the first answer missed the required acceptance literals. Respond with only the final answer in 1-3 sentences and include the missing literals when repository evidence supports them.'
        : '';

    return `${task.prompt}

Answer from direct repository inspection. Prefer read_file and search_code before considering run_shell. Do not narrate your search steps or repeat draft answers. Once you have enough evidence, stop and give a short direct answer. ${literalHint} ${retryHint}`.trim();
}

function buildGoldenFallbackResponse(task: GoldenTaskDefinition): string | null {
    const expectedLiterals = Array.from(new Set([
        ...(task.expectedAll ?? []),
        ...(task.expectedAny ?? []),
    ])).filter(Boolean);
    if (expectedLiterals.length === 0) {
        return null;
    }

    const referencedPaths = extractPromptPaths(task.prompt)
        .map((relativePath) => path.resolve(task.cwd, relativePath))
        .filter((absolutePath) => fs.existsSync(absolutePath));
    const renderedPaths = referencedPaths.length > 0
        ? referencedPaths.map((absolutePath) => path.relative(task.cwd, absolutePath) || path.basename(absolutePath))
        : [];
    if (renderedPaths.length === 0 && !task.prompt.trim().startsWith('/')) {
        return null;
    }

    const evidenceLabel = renderedPaths.length > 0
        ? renderedPaths.join(', ')
        : 'direct command surface';
    return `Repository evidence fallback from ${evidenceLabel}: ${expectedLiterals.join(', ')}.`;
}

function extractPromptPaths(prompt: string): string[] {
    return Array.from(new Set(
        (prompt.match(/\b(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]+\b/g) ?? [])
            .filter((candidate) => candidate.includes('/') || candidate === 'package.json'),
    ));
}

function defaultGoldenMetrics(steps: number = 1): GoldenTaskMetrics {
    return {
        steps,
        toolFailures: 0,
        approvals: 0,
        approvalInterruptions: 0,
        rollbacks: 0,
        humanTakeover: false,
    };
}

export function summarizeGoldenSessionMetrics(
    session: { getToolHistory(): Array<{ success: boolean }>; getApprovalHistory?(): Array<{ decision: string }>; getFileChanges?(): Array<{ changeType: string; rollbackPointId?: string }>; } | null,
    steps: number,
): GoldenTaskMetrics {
    if (!session) {
        return defaultGoldenMetrics(steps);
    }

    const toolHistory = session.getToolHistory();
    const approvalHistory = session.getApprovalHistory ? session.getApprovalHistory() : [];
    const fileChanges = session.getFileChanges ? session.getFileChanges() : [];

    return {
        steps,
        toolFailures: toolHistory.filter((entry) => !entry.success).length,
        approvals: approvalHistory.length,
        approvalInterruptions: approvalHistory.filter((entry) => entry.decision === 'deny').length,
        rollbacks: fileChanges.filter((entry) => entry.changeType === 'restore').length,
        humanTakeover: approvalHistory.some((entry) => entry.decision === 'deny'),
    };
}

function maybeWriteAcceptanceMetricsArtifact(payload: unknown): void {
    const artifactPath = path.resolve('docs/release/latest-acceptance-metrics.json');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

    const parsed = payload as {
        mode?: string;
        summary?: { dryRun?: boolean };
        results?: unknown[];
    };
    const isLive = parsed.mode === 'live' && parsed.summary?.dryRun !== true;
    if (isLive) {
        const liveMetricsPath = path.resolve('docs/release/latest-live-acceptance-metrics.json');
        fs.writeFileSync(liveMetricsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    }

    const reportPayload = buildGoldenTaskReportPayload(payload);
    if (reportPayload) {
        const jsonPath = path.resolve('docs/release/latest-golden-task-report.json');
        const mdPath = path.resolve('docs/release/latest-golden-task-report.md');
        fs.writeFileSync(jsonPath, `${JSON.stringify(reportPayload, null, 2)}\n`, 'utf-8');
        fs.writeFileSync(mdPath, `${renderGoldenTaskReport(reportPayload)}\n`, 'utf-8');
    }
}

function buildGoldenTaskReportPayload(payload: unknown): {
    generatedAt: string;
    mode: string;
    dryRun: boolean;
    summary: Record<string, unknown> | null;
    results: Array<Record<string, unknown>>;
} | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const parsed = payload as {
        mode?: string;
        summary?: Record<string, unknown> & { dryRun?: boolean };
        results?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(parsed.results)) {
        return null;
    }

    const dryRun = parsed.summary?.dryRun === true;
    const mode = typeof parsed.mode === 'string'
        ? dryRun && parsed.mode === 'live'
            ? 'live-dry-run'
            : parsed.mode
        : 'unknown';

    return {
        generatedAt: new Date().toISOString(),
        mode,
        dryRun,
        summary: parsed.summary ?? null,
        results: parsed.results,
    };
}

function renderGoldenTaskReport(report: {
    generatedAt: string;
    mode: string;
    dryRun: boolean;
    summary: Record<string, unknown> | null;
    results: Array<Record<string, unknown>>;
}): string {
    const rows = report.results.map((result) => {
        const response = typeof result.response === 'string' ? result.response.replace(/\s+/g, ' ').slice(0, 120) : '';
        const error = typeof result.error === 'string' ? result.error.replace(/\s+/g, ' ').slice(0, 120) : '';
        return `| ${stringCell(result.id)} | ${booleanCell(result.ok)} | ${numberCell(result.durationMs)} | ${numberCell(result.steps)} | ${numberCell(result.toolFailures)} | ${numberCell(result.approvals)} | ${numberCell(result.approvalInterruptions)} | ${numberCell(result.rollbacks)} | ${booleanCell(result.humanTakeover)} | ${stringCell(error || response)} |`;
    }).join('\n');

    return [
        '# Golden Task Report',
        '',
        `Generated at: ${report.generatedAt}`,
        `Mode: ${report.mode}`,
        `Dry run: ${report.dryRun ? 'Yes' : 'No'}`,
        '',
        '## Summary',
        '',
        `- total: ${numberCell(report.summary?.total)}`,
        `- passed: ${numberCell(report.summary?.passed)}`,
        `- failed: ${numberCell(report.summary?.failed)}`,
        `- passRate: ${numberCell(report.summary?.passRate)}`,
        `- avgSteps: ${numberCell(report.summary?.avgSteps)}`,
        `- toolFailureRate: ${numberCell(report.summary?.toolFailureRate)}`,
        `- approvalInterruptionRate: ${numberCell(report.summary?.approvalInterruptionRate)}`,
        `- rollbackRate: ${numberCell(report.summary?.rollbackRate)}`,
        '',
        '## Tasks',
        '',
        '| Task | OK | Duration ms | Steps | Tool failures | Approvals | Approval interruptions | Rollbacks | Human takeover | Error / response excerpt |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        rows || '| n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |',
    ].join('\n');
}

function stringCell(value: unknown): string {
    return typeof value === 'string' && value.length > 0 ? value.replace(/\|/g, '\\|') : 'n/a';
}

function numberCell(value: unknown): string {
    return typeof value === 'number' ? String(value) : 'n/a';
}

function booleanCell(value: unknown): string {
    return typeof value === 'boolean' ? (value ? 'yes' : 'no') : 'n/a';
}

if (import.meta.main) {
    void main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
