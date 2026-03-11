import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ErrorAnalyzer,
    NodeRunner,
    ProjectDetector,
} from '@xqoder/runtime';
import {
    ProjectType,
    RuntimeStatus,
    RuntimeErrorType,
    type LLMProviderConfig,
    type LLMProviderName,
    type RunReport,
    type XQoderConfig,
    normalizeLLMConfig,
} from '@xqoder/shared';
import type { FixProjectFlowRuntime } from '@xqoder/workflow';

export type FixFixtureName =
    | 'syntax-error'
    | 'missing-local-module'
    | 'missing-script'
    | 'port-conflict'
    | 'next-missing-env'
    | 'vite-typescript-error';

export interface RealLlmE2ESettings {
    enabled: boolean;
    fixtures: FixFixtureName[];
    maxAttempts: number;
    llmConfig?: LLMProviderConfig;
    skipReason?: string;
}

const tempDirs = new Set<string>();
const supportedFixtures = new Set<FixFixtureName>([
    'syntax-error',
    'missing-local-module',
    'missing-script',
    'port-conflict',
    'next-missing-env',
    'vite-typescript-error',
]);
const fixturesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '__fixtures__',
    'fix',
);

export function createTempProjectFromFixture(name: FixFixtureName): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `xqoder-fix-${name}-`));
    tempDirs.add(dir);
    fs.cpSync(path.join(fixturesDir, name), dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    return dir;
}

export function cleanupTempProjects(): void {
    for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
        tempDirs.delete(dir);
    }
}

export function createIntegrationRuntime(): FixProjectFlowRuntime {
    const runner = new NodeRunner();
    (runner as unknown as {
        portDetector: {
            findAvailablePort(startPort: number): Promise<number>;
            waitForPort(): Promise<boolean>;
        };
    }).portDetector = {
        findAvailablePort: async (startPort: number) => startPort,
        waitForPort: async () => false,
    };

    const detector = new ProjectDetector();
    const analyzer = new ErrorAnalyzer();

    return {
        async start(projectDir: string): Promise<RunReport> {
            const detection = detector.detect(projectDir);
            const startedAt = new Date();
            const state = await runner.start(projectDir);

            return {
                status: state.status,
                projectDir,
                projectType: ProjectType.Node,
                framework: detection.framework,
                packageManager: state.packageManager,
                command: state.command,
                port: state.port,
                url: state.url,
                pid: state.pid,
                errors: state.errors.map((message) => ({
                    type: RuntimeErrorType.RuntimeException,
                    message,
                })),
                logs: runner.getLogWatcher().getRecentLogs().map((entry) => entry.content),
                startedAt,
                completedAt: state.status === RuntimeStatus.Running ? undefined : new Date(),
            };
        },
        analyzeErrors() {
            const logText = runner.getLogWatcher().getErrorLogs().map((entry) => entry.content).join('\n');
            return analyzer.analyze(logText);
        },
        async stop() {
            await runner.stop();
        },
    };
}

export function getRealLlmE2ESettings(
    env: NodeJS.ProcessEnv = process.env,
): RealLlmE2ESettings {
    const fixtures = parseFixtureList(env.XQODER_E2E_FIXTURES);
    const maxAttempts = parsePositiveInteger(env.XQODER_E2E_MAX_ATTEMPTS, 2);

    if (env.XQODER_REAL_LLM_E2E !== '1') {
        return {
            enabled: false,
            fixtures,
            maxAttempts,
            skipReason: 'Set XQODER_REAL_LLM_E2E=1 to enable online LLM E2E tests.',
        };
    }

    const provider = (env.XQODER_E2E_PROVIDER ?? 'openai') as string;
    if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'dashscope') {
        return {
            enabled: false,
            fixtures,
            maxAttempts,
            skipReason: `Unsupported XQODER_E2E_PROVIDER: ${provider}`,
        };
    }

    const apiKey = env.XQODER_E2E_API_KEY
        ?? getProviderApiKeyFromEnv(provider, env);
    if (!apiKey) {
        return {
            enabled: false,
            fixtures,
            maxAttempts,
            skipReason: getMissingApiKeyMessage(provider),
        };
    }

    return {
        enabled: true,
        fixtures,
        maxAttempts,
        llmConfig: normalizeLLMConfig({
            provider,
            model: env.XQODER_E2E_MODEL,
            apiKey,
            baseUrl: env.XQODER_E2E_BASE_URL,
            temperature: 0,
            maxTokens: 4096,
        }),
    };
}

export function createRealLlmE2EConfig(settings: RealLlmE2ESettings): XQoderConfig {
    if (!settings.enabled || !settings.llmConfig) {
        throw new Error(settings.skipReason ?? 'Real LLM E2E is not enabled.');
    }

    return {
        llm: settings.llmConfig,
        debug: false,
        recentProjects: [],
    };
}

function parseFixtureList(input?: string): FixFixtureName[] {
    if (!input) {
        return ['syntax-error'];
    }

    const fixtures = input
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value): value is FixFixtureName => supportedFixtures.has(value as FixFixtureName));

    return fixtures.length > 0 ? fixtures : ['syntax-error'];
}

function parsePositiveInteger(input: string | undefined, fallback: number): number {
    if (!input) {
        return fallback;
    }

    const parsed = Number.parseInt(input, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getProviderApiKeyFromEnv(
    provider: LLMProviderName,
    env: NodeJS.ProcessEnv,
): string | undefined {
    switch (provider) {
        case 'openai':
            return env.OPENAI_API_KEY;
        case 'anthropic':
            return env.ANTHROPIC_API_KEY;
        case 'dashscope':
            return env.DASHSCOPE_API_KEY;
        case 'gemini':
            return env.GOOGLE_API_KEY;
        default:
            return undefined;
    }
}

function getMissingApiKeyMessage(provider: LLMProviderName): string {
    switch (provider) {
        case 'openai':
            return 'Missing XQODER_E2E_API_KEY or OPENAI_API_KEY.';
        case 'anthropic':
            return 'Missing XQODER_E2E_API_KEY or ANTHROPIC_API_KEY.';
        case 'dashscope':
            return 'Missing XQODER_E2E_API_KEY or DASHSCOPE_API_KEY.';
        case 'gemini':
            return 'Missing XQODER_E2E_API_KEY or GOOGLE_API_KEY.';
        default:
            return `Missing XQODER_E2E_API_KEY for provider: ${provider}.`;
    }
}
