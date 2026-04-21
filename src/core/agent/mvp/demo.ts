import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LLMMessage } from '@xqoder/shared';
import type {
    CompletionRequest,
    CompletionResponse,
    ILLMProvider,
} from '../llm/provider.js';
import { XQoderAgent } from '../agent.js';
import { FileRollbackStore } from '../tools/rollback-store.js';
import { runMvpVerification } from './verifier.js';

export const MVP_TYPEERROR_DEMO_PROMPT = '修复 src/utils.ts 里的 TypeError: Cannot read property "id" of undefined';
const INITIAL_UTILS_SOURCE = `export interface DemoUser {
    id?: string;
}

export function getPrimaryUserId(currentUser?: DemoUser): string {
    return currentUser.id.toUpperCase();
}
`;
const INTERMEDIATE_UTILS_SOURCE = `export interface DemoUser {
    id?: string;
}

export function getPrimaryUserId(currentUser?: DemoUser): string {
    return currentUser?.id?.toUpperCase();
}
`;
const FINAL_UTILS_SOURCE = `export interface DemoUser {
    id?: string;
}

export function getPrimaryUserId(currentUser?: DemoUser): string {
    const id = currentUser?.id;

    if (typeof id !== 'string' || id.trim().length === 0) {
        return 'UNKNOWN';
    }

    return id.toUpperCase();
}
`;
const DEMO_FILES: Readonly<Record<string, string>> = {
    'xqoder.md': `# XQoder MVP Demo Rules
- Keep changes minimal and localized to the bug.
- Prefer guard clauses and explicit fallbacks over broad refactors.
- After every write, stay in the loop until tests pass.
`,
    'package.json': `${JSON.stringify({
        name: 'xqoder-mvp-typeerror-demo',
        private: true,
        type: 'module',
        scripts: {
            test: 'bun test',
            lint: 'node ./scripts/lint.mjs',
            build: 'node ./scripts/build.mjs',
        },
    }, null, 2)}
`,
    'src/utils.ts': INITIAL_UTILS_SOURCE,
    'src/index.ts': `import { getPrimaryUserId, type DemoUser } from './utils';

export function renderCurrentUser(currentUser?: DemoUser): string {
    return \`user:\${getPrimaryUserId(currentUser)}\`;
}
`,
    'test/utils.test.ts': `import { describe, expect, it } from 'bun:test';
import { getPrimaryUserId } from '../src/utils';
import { renderCurrentUser } from '../src/index';

describe('getPrimaryUserId', () => {
    it('returns uppercase id for an existing user', () => {
        expect(getPrimaryUserId({ id: 'abc-123' })).toBe('ABC-123');
    });

    it('returns UNKNOWN when the user is missing', () => {
        expect(getPrimaryUserId(undefined)).toBe('UNKNOWN');
    });

    it('returns UNKNOWN when the id is missing', () => {
        expect(getPrimaryUserId({})).toBe('UNKNOWN');
    });
});

describe('renderCurrentUser', () => {
    it('uses the same fallback path for missing users', () => {
        expect(renderCurrentUser(undefined)).toBe('user:UNKNOWN');
    });
});
`,
    'scripts/lint.mjs': `import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/utils.ts', import.meta.url), 'utf8');

if (source.includes('TODO')) {
    console.error('Unexpected TODO left in src/utils.ts');
    process.exit(1);
}

process.exit(0);
`,
    'scripts/build.mjs': `import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/utils.ts', import.meta.url), 'utf8');

if (!source.includes('export function getPrimaryUserId')) {
    console.error('src/utils.ts does not export getPrimaryUserId');
    process.exit(1);
}

process.exit(0);
`,
};

export interface MvpTypeErrorDemoOptions {
    workspaceDir?: string;
    cleanup?: boolean;
}

export interface MvpTypeErrorDemoResult {
    prompt: string;
    workspaceDir: string;
    finalResponse: string;
    providerRequests: number;
    toolSequence: string[];
    verificationPassed: boolean;
    verificationSummary: string;
    verificationMessages: string[];
    recoveryMessages: string[];
    plannerPrompt: string;
    finalUtilsSource: string;
    cleanedUp: boolean;
}

export async function runMvpTypeErrorClosedLoopDemo(
    options: MvpTypeErrorDemoOptions = {},
): Promise<MvpTypeErrorDemoResult> {
    const workspaceDir = createMvpTypeErrorDemoWorkspace(options.workspaceDir);
    const provider = createMvpTypeErrorDemoProvider();
    const toolSequence: string[] = [];
    const agent = new XQoderAgent({
        llmConfig: {
            provider: 'openai',
            model: 'mvp-demo-scripted',
            apiKey: 'demo-key',
        },
        cwd: workspaceDir,
        projectRoot: workspaceDir,
        runtimeProfile: 'mvp',
        permissions: {
            defaultMode: 'allow',
            tools: {},
        },
        rollbackStore: new FileRollbackStore(path.join(workspaceDir, '.rollbacks')),
        contextPaths: ['xqoder.md'],
        providerFactory: async () => provider,
    });

    let result: MvpTypeErrorDemoResult | undefined;

    try {
        const finalResponse = await agent.run(MVP_TYPEERROR_DEMO_PROMPT, {
            onToolStart: (name) => {
                toolSequence.push(name);
            },
        });

        const verification = await runMvpVerification({
            projectRoot: workspaceDir,
        });
        const sessionMessages = agent.getSession().getMessages();
        const plannerPrompt = provider.requests[0]
            ? findLatestSystemMessage(provider.requests[0].messages)
            : '';

        result = {
            prompt: MVP_TYPEERROR_DEMO_PROMPT,
            workspaceDir,
            finalResponse,
            providerRequests: provider.requests.length,
            toolSequence,
            verificationPassed: verification.ok,
            verificationSummary: verification.summary,
            verificationMessages: sessionMessages
                .filter((message) => message.role === 'system' && message.content.includes('Verifier status:'))
                .map((message) => message.content),
            recoveryMessages: sessionMessages
                .filter((message) => message.role === 'system' && message.content.includes('Recovery manager:'))
                .map((message) => message.content),
            plannerPrompt,
            finalUtilsSource: fs.readFileSync(path.join(workspaceDir, 'src/utils.ts'), 'utf-8'),
            cleanedUp: false,
        };
    } finally {
        await agent.dispose();
        if (options.cleanup !== false) {
            fs.rmSync(workspaceDir, { recursive: true, force: true });
            if (result) {
                result.cleanedUp = true;
            }
        }
    }

    if (!result) {
        throw new Error('MVP TypeError demo did not produce a result.');
    }

    return result;
}

export function formatMvpTypeErrorDemoReport(result: MvpTypeErrorDemoResult): string {
    return [
        'XQoder MVP TypeError Demo',
        `Prompt: ${result.prompt}`,
        `Workspace: ${result.workspaceDir}`,
        `Provider requests: ${result.providerRequests}`,
        `Tool sequence: ${result.toolSequence.join(' -> ')}`,
        `Verification passed: ${result.verificationPassed ? 'yes' : 'no'}`,
        `Verification summary: ${result.verificationSummary}`,
        '',
        'Planner prompt preview:',
        indentBlock(result.plannerPrompt || '(missing)'),
        '',
        'Recovery messages:',
        indentBlock(result.recoveryMessages.join('\n\n') || '(none)'),
        '',
        'Final verifier messages:',
        indentBlock(result.verificationMessages.join('\n\n') || '(none)'),
        '',
        'Final response:',
        indentBlock(result.finalResponse),
        '',
        'Final src/utils.ts:',
        indentBlock(result.finalUtilsSource),
    ].join('\n');
}

export function createMvpTypeErrorDemoWorkspace(workspaceDir?: string): string {
    const resolvedWorkspace = workspaceDir
        ? path.resolve(workspaceDir)
        : fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-mvp-typeerror-demo-'));
    fs.rmSync(resolvedWorkspace, { recursive: true, force: true });
    fs.mkdirSync(resolvedWorkspace, { recursive: true });

    for (const [relativePath, content] of Object.entries(DEMO_FILES)) {
        const absolutePath = path.join(resolvedWorkspace, relativePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, content, 'utf-8');
    }

    return resolvedWorkspace;
}

export function createMvpTypeErrorDemoProvider(): ILLMProvider & { requests: CompletionRequest[] } {
    return new ScriptedTypeErrorDemoProvider();
}

function findLatestSystemMessage(messages: LLMMessage[]): string {
    const reversed = [...messages].reverse();
    return reversed.find((message) => message.role === 'system')?.content ?? '';
}

function indentBlock(value: string): string {
    return value
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
}

class ScriptedTypeErrorDemoProvider implements ILLMProvider {
    readonly name = 'scripted-mvp-demo';
    readonly model = 'scripted-mvp-demo';
    readonly requests: CompletionRequest[] = [];

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
        return this.resolve(request);
    }

    async stream(request: CompletionRequest): Promise<CompletionResponse> {
        return this.resolve(request);
    }

    private async resolve(request: CompletionRequest): Promise<CompletionResponse> {
        this.requests.push(request);
        const step = this.requests.length - 1;

        switch (step) {
            case 0:
                return createToolCallResponse('demo-search-1', 'search_code', {
                    pattern: 'getPrimaryUserId|renderCurrentUser',
                    path: '.',
                    include: '*.ts',
                });
            case 1:
                return createMultiToolCallResponse([
                    {
                        id: 'demo-read-utils-1',
                        name: 'read_file',
                        arguments: JSON.stringify({ path: 'src/utils.ts' }),
                    },
                    {
                        id: 'demo-read-index-1',
                        name: 'read_file',
                        arguments: JSON.stringify({ path: 'src/index.ts' }),
                    },
                ]);
            case 2:
                return createToolCallResponse('demo-write-utils-1', 'write_file', {
                    path: 'src/utils.ts',
                    content: INTERMEDIATE_UTILS_SOURCE,
                });
            case 3:
                return createStopResponse('已修复 TypeError，应该可以结束了。');
            case 4:
                return createToolCallResponse('demo-read-test-1', 'read_file', {
                    path: 'test/utils.test.ts',
                });
            case 5:
                return createToolCallResponse('demo-write-utils-2', 'write_file', {
                    path: 'src/utils.ts',
                    content: FINAL_UTILS_SOURCE,
                });
            default:
                return createStopResponse('修复完成：src/utils.ts 已补上 guard clause，测试、lint、build 全部通过。');
        }
    }
}

function createToolCallResponse(
    id: string,
    name: string,
    argumentsObject: Record<string, unknown>,
): CompletionResponse {
    return createResponse({
        finishReason: 'tool_calls',
        message: {
            role: 'assistant',
            content: '',
            toolCalls: [
                {
                    id,
                    name,
                    arguments: JSON.stringify(argumentsObject),
                },
            ],
        },
    });
}

function createMultiToolCallResponse(toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
}>): CompletionResponse {
    return createResponse({
        finishReason: 'tool_calls',
        message: {
            role: 'assistant',
            content: '',
            toolCalls,
        },
    });
}

function createStopResponse(content: string): CompletionResponse {
    return createResponse({
        finishReason: 'stop',
        message: {
            role: 'assistant',
            content,
        },
    });
}

function createResponse(input: Pick<CompletionResponse, 'finishReason' | 'message'>): CompletionResponse {
    return {
        ...input,
        usage: {
            promptTokens: 120,
            completionTokens: 40,
            totalTokens: 160,
        },
    };
}
