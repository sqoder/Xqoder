import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger as defaultLogger } from '@xqoder/shared';
import { AgentSession } from '../../../src/core/agent/session/session.js';
import {
    type ConversationEngine,
    ConversationEngineStopError,
    runConversationEngine,
    runConversationTurn,
    streamConversationTurn,
} from '../../../src/application/chat/conversation-engine.js';
import type { ConversationTurnInput } from '../../../src/application/chat/turn-intake.js';
import type { ConversationEventEnvelope } from '@xqoder/protocol';
import { createMvpConversationRuntime } from '../../../src/core/agent/mvp/conversation-runtime.js';

describe('conversation engine', () => {
    it('exposes the documented public runTurn protocol shape', () => {
        const engine = {
            runTurn(_input: ConversationTurnInput): AsyncIterable<ConversationEventEnvelope> {
                return (async function* () {})();
            },
        } satisfies ConversationEngine;

        expect(typeof engine.runTurn).toBe('function');
    });

    it('treats the streaming entrypoint as the canonical envelope source and keeps the drain helper compatible', async () => {
        const session = new AgentSession({ id: 'conversation-engine-stream-source', systemPrompt: 'system' });
        const streamedEvents = [];

        for await (const event of streamConversationTurn({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'stream canonical',
                        },
                        usage: {
                            promptTokens: 9,
                            completionTokens: 3,
                            totalTokens: 12,
                        },
                    };
                },
            },
            session,
            userMessage: 'stream this turn',
            attachments: [],
            streamId: 'stream-canonical',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'full',
            emit: (() => undefined) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async () => [],
        })) {
            streamedEvents.push(event);
        }

        expect(streamedEvents.at(-1)).toMatchObject({
            type: 'status.changed',
            payload: {
                status: 'done',
                stopReason: 'completed',
            },
        });
        expect(streamedEvents.find((event) => event.type === 'message.completed' && event.payload.message.role === 'assistant')).toMatchObject({
            payload: {
                message: {
                    content: 'stream canonical',
                },
            },
        });

        const drainedSession = new AgentSession({ id: 'conversation-engine-stream-drain', systemPrompt: 'system' });
        const drainedResult = await runConversationTurn({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'drained helper',
                        },
                        usage: {
                            promptTokens: 8,
                            completionTokens: 2,
                            totalTokens: 10,
                        },
                    };
                },
            },
            session: drainedSession,
            userMessage: 'drain this turn',
            attachments: [],
            streamId: 'stream-drained',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'full',
            emit: (() => undefined) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async () => [],
        });

        expect(drainedResult).toMatchObject({
            response: 'drained helper',
            stopReason: 'completed',
        });
        expect(drainedSession.getConversationEventEnvelopes().at(-1)).toMatchObject({
            type: 'status.changed',
            payload: {
                status: 'done',
                stopReason: 'completed',
            },
        });
    });

    it('continues the loop across tool calls until a final assistant response is returned', async () => {
        const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
        const toolExecutions: string[] = [];
        const events: string[] = [];
        const session = new AgentSession({ id: 'conversation-engine-tool-loop', systemPrompt: 'system' });

        const result = await runConversationEngine({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream(request) {
                    requests.push({
                        messages: request.messages.map((message) => ({
                            role: message.role,
                            content: String(message.content ?? ''),
                        })),
                    });
                    if (requests.length === 1) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'tool-call-1',
                                    name: 'echo_tool',
                                    arguments: '{"target":"src/utils.ts"}',
                                }],
                            },
                            usage: {
                                promptTokens: 10,
                                completionTokens: 3,
                                totalTokens: 13,
                            },
                        };
                    }
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'done',
                        },
                        usage: {
                            promptTokens: 15,
                            completionTokens: 4,
                            totalTokens: 19,
                        },
                    };
                },
            },
            session,
            userMessage: 'fix it',
            attachments: [],
            callbacks: {
                onIteration: () => {},
            },
            streamId: 'stream-1',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'full',
            maxIterations: 4,
            emit: ((type) => {
                events.push(type);
            }) as any,
            getToolDefinitions: () => [{
                name: 'echo_tool',
                description: 'Echo a path',
                parameters: [],
            }],
            executeToolCalls: async (toolCalls, _callbacks, streamId) => {
                toolExecutions.push(toolCalls[0]!.name);
                session.addToolResult(toolCalls[0]!.id, 'tool-result:src/utils.ts');
                events.push(`tool_response:${streamId}`);
            },
            syncMcpTools: async () => {},
        });

        expect(result).toBe('done');
        expect(toolExecutions).toEqual(['echo_tool']);
        expect(requests).toHaveLength(2);
        expect(requests[1]!.messages.some((message) => message.role === 'tool' && message.content.includes('tool-result:src/utils.ts'))).toBe(true);
        expect(events).toContain('tool_response:stream-1');
        expect(events).toContain('agent_end');
    });

    it('keeps looping when the runtime blocks completion and only finishes after the blocker clears', async () => {
        const session = new AgentSession({ id: 'conversation-engine-blocker', systemPrompt: 'system' });
        let blockerActive = true;
        let providerCalls = 0;

        const result = await runConversationEngine({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    providerCalls += 1;
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: providerCalls === 1 ? 'draft' : 'verified',
                        },
                        usage: {
                            promptTokens: 8,
                            completionTokens: 2,
                            totalTokens: 10,
                        },
                    };
                },
            },
            session,
            userMessage: 'answer carefully',
            attachments: [],
            streamId: 'stream-2',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'hybrid',
            maxIterations: 4,
            emit: (() => {}) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async () => {},
            createRuntime: () => ({
                prepareMessages: () => session.getMessages(),
                async runPostToolVerification() {},
                getForcedStopMessage: () => undefined,
                getCompletionBlocker: () => {
                    if (!blockerActive) {
                        return undefined;
                    }
                    blockerActive = false;
                    return 'verification still pending';
                },
                getNoToolCompletionBlocker: () => undefined,
                finalizeAssistantResponse: (content) => `FINAL:${content}`,
            }),
        });

        expect(result).toBe('FINAL:verified');
        expect(providerCalls).toBe(2);
        expect(session.getMessages().some((message) => message.role === 'system' && message.content.includes('verification still pending'))).toBe(true);
    });

    it('does not stream or store assistant drafts when runtime requires tool evidence first', async () => {
        const session = new AgentSession({ id: 'conversation-engine-defer-tool-evidence', systemPrompt: 'system' });
        const streamedEvents: ConversationEventEnvelope[] = [];
        const toolExecutions: string[] = [];
        let providerCalls = 0;

        for await (const event of streamConversationTurn({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream(request, callbacks) {
                    providerCalls += 1;
                    if (providerCalls === 1) {
                        callbacks.onToken?.('fake read_file claim');
                        return {
                            finishReason: 'stop',
                            message: {
                                role: 'assistant',
                                content: 'fake read_file claim',
                            },
                            usage: {
                                promptTokens: 10,
                                completionTokens: 4,
                                totalTokens: 14,
                            },
                        };
                    }

                    if (providerCalls === 2) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'tool-call-read-html',
                                    name: 'read_file',
                                    arguments: '{"path":"/Users/wangxinglin/Downloads/code.html"}',
                                }],
                            },
                            usage: {
                                promptTokens: 12,
                                completionTokens: 2,
                                totalTokens: 14,
                            },
                        };
                    }

                    callbacks.onToken?.('real analysis');
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'real analysis',
                        },
                        usage: {
                            promptTokens: 15,
                            completionTokens: 3,
                            totalTokens: 18,
                        },
                    };
                },
            },
            session,
            userMessage: '/Users/wangxinglin/Downloads/code.html 帮我分析一下这个项目',
            attachments: [],
            streamId: 'stream-defer-tool-evidence',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'hybrid',
            maxIterations: 5,
            emit: (() => {}) as any,
            getToolDefinitions: () => [{
                name: 'read_file',
                description: 'Read a file',
                parameters: [],
            }],
            executeToolCalls: async (toolCalls) => {
                const toolCall = toolCalls[0]!;
                toolExecutions.push(toolCall.name);
                session.recordToolExecution({
                    id: toolCall.id,
                    name: toolCall.name,
                    args: { path: '/Users/wangxinglin/Downloads/code.html' },
                    success: true,
                    output: '<title>Next 3 — 每天三步</title>',
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(toolCall.id, '<title>Next 3 — 每天三步</title>');
            },
            createRuntime: () => ({
                prepareMessages: () => session.getMessages(),
                async runPostToolVerification() {},
                getForcedStopMessage: () => undefined,
                getCompletionBlocker: () => undefined,
                getNoToolCompletionBlocker: (toolUsed) => toolUsed ? undefined : 'The user named a concrete path.',
                shouldDeferAssistantOutput: (toolUsed) => !toolUsed,
                finalizeAssistantResponse: (content) => content,
            }),
        })) {
            streamedEvents.push(event);
        }

        const assistantDeltaText = streamedEvents
            .filter((event) => event.type === 'message.delta')
            .map((event) => event.payload.text)
            .join('');
        const assistantCompleted = streamedEvents.find((event) => (
            event.type === 'message.completed'
            && event.payload.message.role === 'assistant'
        ));

        expect(providerCalls).toBe(3);
        expect(toolExecutions).toEqual(['read_file']);
        expect(assistantDeltaText).not.toContain('fake read_file claim');
        expect(assistantDeltaText).toContain('real analysis');
        expect(assistantCompleted).toMatchObject({
            payload: {
                message: {
                    content: 'real analysis',
                },
            },
        });
        expect(session.getMessages().some((message) => (
            message.role === 'assistant'
            && String(message.content).includes('fake read_file claim')
        ))).toBe(false);
    });

    it('auto-runs read-only key-file follow-ups after list_files evidence instead of looping to max_loops', async () => {
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-directory-analysis-'));
        fs.writeFileSync(path.join(projectRoot, 'Package.swift'), '// swift package manifest');
        const rootViewPath = path.join(projectRoot, 'Today3', 'App', 'RootView.swift');
        const plannerPath = path.join(projectRoot, 'Sources', 'Today3Core', 'Services', 'PlannerEngine.swift');
        const docsPath = path.join(projectRoot, 'Docs', 'AppStoreMetadata.md');
        fs.mkdirSync(path.dirname(rootViewPath), { recursive: true });
        fs.mkdirSync(path.dirname(plannerPath), { recursive: true });
        fs.mkdirSync(path.dirname(docsPath), { recursive: true });
        fs.writeFileSync(rootViewPath, 'struct RootView: View {}');
        fs.writeFileSync(plannerPath, 'public struct PlannerEngine {}');
        fs.writeFileSync(docsPath, '# App Store Metadata');
        const session = new AgentSession({ id: 'conversation-engine-directory-analysis', systemPrompt: 'system' });
        const userMessage = `${projectRoot} 分析一下这个项目是干嘛的`;
        const toolExecutions: string[] = [];
        let providerCalls = 0;

        try {
            const result = await runConversationEngine({
                provider: {
                    name: 'fake-provider',
                    model: 'fake-model',
                    async complete() {
                        throw new Error('complete() should not be used');
                    },
                    async stream() {
                        providerCalls += 1;
                        if (providerCalls === 1) {
                            return {
                                finishReason: 'tool_calls',
                                message: {
                                    role: 'assistant',
                                    content: '',
                                    toolCalls: [{
                                        id: 'list-directory-project',
                                        name: 'list_files',
                                        arguments: JSON.stringify({ path: projectRoot }),
                                    }],
                                },
                                usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
                            };
                        }

                        if (providerCalls === 2) {
                            return {
                                finishReason: 'stop',
                                message: {
                                    role: 'assistant',
                                    content: '只根据目录列表的提前回答',
                                },
                                usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
                            };
                        }

                        if (providerCalls === 3) {
                            return {
                                finishReason: 'stop',
                                message: {
                                    role: 'assistant',
                                    content: '只根据 Package.swift 的提前回答',
                                },
                                usage: { promptTokens: 16, completionTokens: 4, totalTokens: 20 },
                            };
                        }

                        if (providerCalls === 4) {
                            return {
                                finishReason: 'stop',
                                message: {
                                    role: 'assistant',
                                    content: '只根据 RootView.swift 的提前回答',
                                },
                                usage: { promptTokens: 18, completionTokens: 4, totalTokens: 22 },
                            };
                        }

                        if (providerCalls === 5) {
                            return {
                                finishReason: 'stop',
                                message: {
                                    role: 'assistant',
                                    content: '只根据源代码的提前回答',
                                },
                                usage: { promptTokens: 20, completionTokens: 4, totalTokens: 24 },
                            };
                        }

                        return {
                            finishReason: 'stop',
                            message: {
                                role: 'assistant',
                                content: '这是一个 Swift/iOS 相关项目，包含 Package.swift、RootView、PlannerEngine 核心规划逻辑和 App Store 文档。',
                            },
                            usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18 },
                        };
                    },
                },
                session,
                userMessage,
                attachments: [],
                streamId: 'stream-directory-analysis',
                abortSignal: new AbortController().signal,
                logger: defaultLogger.child('conversation-engine-test'),
                llmConfig: {
                    provider: 'openai',
                    model: 'gpt-4.1',
                    apiKey: 'test-key',
                },
                runtimeProfile: 'hybrid',
                maxIterations: 8,
                emit: (() => {}) as any,
                getToolDefinitions: () => [
                    {
                        name: 'list_files',
                        description: 'List files',
                        parameters: [],
                    },
                    {
                        name: 'read_file',
                        description: 'Read file',
                        parameters: [],
                    },
                ],
                executeToolCalls: async (toolCalls) => {
                    const toolCall = toolCalls[0]!;
                    toolExecutions.push(toolCall.name);
                    const args = JSON.parse(toolCall.arguments);
                    const output = toolCall.name === 'read_file' && args.path === rootViewPath
                        ? 'struct RootView: View {}'
                        : toolCall.name === 'read_file' && args.path === plannerPath
                        ? 'public struct PlannerEngine {}'
                        : toolCall.name === 'read_file' && args.path === docsPath
                        ? '# App Store Metadata'
                        : toolCall.name === 'read_file'
                        ? '// swift package manifest'
                        : [
                            '- Package.swift',
                            '- Today3/App/RootView.swift',
                            '- Sources/Today3Core/Services/PlannerEngine.swift',
                            '- Docs/AppStoreMetadata.md',
                        ].join('\n');
                    session.recordToolExecution({
                        id: toolCall.id,
                        name: toolCall.name,
                        args,
                        success: true,
                        output,
                        startedAt: new Date(),
                        completedAt: new Date(),
                    });
                    session.addToolResult(toolCall.id, output);
                },
                createRuntime: () => createMvpConversationRuntime({
                    userGoal: userMessage,
                    projectRoot,
                    session,
                    runtimeProfile: 'hybrid',
                    runtimeConfig: {
                        baselineCheck: false,
                        distillVerifier: false,
                        stopConditions: {
                            hard: [],
                            soft: [],
                            maxLoops: 8,
                        },
                    },
                }),
            });

            expect(result).toContain('Swift/iOS');
            expect(providerCalls).toBe(6);
            expect(toolExecutions).toEqual(['list_files', 'read_file', 'read_file', 'read_file', 'read_file']);
            expect(session.getMessages().some((message) => (
                message.role === 'system'
                && String(message.content).includes('Directory project analysis key-file follow-up required')
                && String(message.content).includes(`read_file {"path":"${path.join(projectRoot, 'Package.swift')}"}`)
            ))).toBe(true);
            expect(session.getMessages().some((message) => (
                message.role === 'system'
                && String(message.content).includes('source entry or core module')
                && String(message.content).includes(`read_file {"path":"${rootViewPath}"}`)
            ))).toBe(true);
            expect(session.getMessages().some((message) => (
                message.role === 'system'
                && String(message.content).includes('Only one source file has been read')
                && String(message.content).includes(`read_file {"path":"${plannerPath}"}`)
            ))).toBe(true);
            expect(session.getMessages().some((message) => (
                message.role === 'system'
                && String(message.content).includes('Docs file or project configuration file')
                && String(message.content).includes(`read_file {"path":"${docsPath}"}`)
            ))).toBe(true);
            expect(session.getMessages().some((message) => (
                message.role === 'assistant'
                && String(message.content).includes('只根据目录列表的提前回答')
            ))).toBe(false);
            expect(session.getMessages().some((message) => (
                message.role === 'assistant'
                && String(message.content).includes('只根据 Package.swift 的提前回答')
            ))).toBe(false);
            expect(session.getMessages().some((message) => (
                message.role === 'assistant'
                && String(message.content).includes('只根据 RootView.swift 的提前回答')
            ))).toBe(false);
            expect(session.getMessages().some((message) => (
                message.role === 'assistant'
                && String(message.content).includes('只根据源代码的提前回答')
            ))).toBe(false);
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    it('auto-runs GitHub repository inspection evidence instead of looping to max_loops', async () => {
        const session = new AgentSession({ id: 'conversation-engine-url-analysis', systemPrompt: 'system' });
        const targetUrl = 'https://github.com/paoloanzn/free-code.git';
        const userMessage = `${targetUrl}那帮我看下这个仓库呢`;
        const toolExecutions: string[] = [];
        let providerCalls = 0;

        const result = await runConversationEngine({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    providerCalls += 1;
                    if (providerCalls === 1) {
                        return {
                            finishReason: 'stop',
                            message: {
                                role: 'assistant',
                                content: '提前回答：这是一个 GitHub 仓库。',
                            },
                            usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
                        };
                    }

                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: '根据 README、package.json 和 src/entrypoints/cli.tsx 证据，这是 free-code 仓库。',
                        },
                        usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
                    };
                },
            },
            session,
            userMessage,
            attachments: [],
            streamId: 'stream-url-analysis',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'mvp',
            maxIterations: 6,
            emit: (() => {}) as any,
            getToolDefinitions: () => [
                {
                    name: 'inspect_github_repo',
                    description: 'Inspect GitHub repo',
                    parameters: [],
                },
                {
                    name: 'fetch_url',
                    description: 'Fetch URL',
                    parameters: [],
                },
            ],
            executeToolCalls: async (toolCalls) => {
                const toolCall = toolCalls[0]!;
                const args = JSON.parse(toolCall.arguments);
                toolExecutions.push(`${toolCall.name}:${args.url}`);
                const output = [
                    '# GitHub Repository Inspection',
                    '',
                    'Repository: paoloanzn/free-code',
                    '## Evidence completeness',
                    '- structure: yes (120 files discovered)',
                    '- overview: yes (README.md)',
                    '- source/config: yes (package.json)',
                    '## Key evidence files',
                    '### README.md (overview)',
                    '### package.json (config)',
                    '### src/entrypoints/cli.tsx (source)',
                ].join('\n');
                session.recordToolExecution({
                    id: toolCall.id,
                    name: toolCall.name,
                    args,
                    success: true,
                    output,
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(toolCall.id, output);
            },
            createRuntime: () => createMvpConversationRuntime({
                userGoal: userMessage,
                projectRoot: process.cwd(),
                session,
                runtimeProfile: 'mvp',
                runtimeConfig: {
                    baselineCheck: false,
                    distillVerifier: false,
                    stopConditions: {
                        hard: [],
                        soft: [],
                        maxLoops: 6,
                    },
                },
            }),
        });

        expect(result).toContain('package.json');
        expect(result).toContain('src/entrypoints/cli.tsx');
        expect(providerCalls).toBe(2);
        expect(toolExecutions).toEqual([`inspect_github_repo:${targetUrl}`]);
        expect(session.getMessages().some((message) => (
            message.role === 'system'
            && String(message.content).includes('concrete URL')
            && String(message.content).includes(`inspect_github_repo {"url":"${targetUrl}","maxFiles":80}`)
        ))).toBe(true);
        expect(session.getMessages().some((message) => (
            message.role === 'assistant'
            && String(message.content).includes('提前回答')
        ))).toBe(false);
    });

    it('keeps large-file analysis drafts silent until post-failure evidence is sufficient', async () => {
        const targetPath = '/Users/wangxinglin/Downloads/code.html';
        const userMessage = `${targetPath} 帮我分析一下这个项目`;
        const session = new AgentSession({ id: 'conversation-engine-large-file-analysis', systemPrompt: 'system' });
        const streamedEvents: ConversationEventEnvelope[] = [];
        const toolExecutions: string[] = [];
        let providerCalls = 0;

        for await (const event of streamConversationTurn({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream(_request, callbacks) {
                    providerCalls += 1;

                    if (providerCalls === 1) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'read-large-full',
                                    name: 'read_file',
                                    arguments: JSON.stringify({ path: targetPath }),
                                }],
                            },
                            usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
                        };
                    }

                    if (providerCalls === 2) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'read-large-first-range',
                                    name: 'read_file',
                                    arguments: JSON.stringify({ path: targetPath, startLine: 1, endLine: 220 }),
                                }],
                            },
                            usage: { promptTokens: 12, completionTokens: 2, totalTokens: 14 },
                        };
                    }

                    if (providerCalls === 3) {
                        callbacks.onToken?.('premature generic summary');
                        return {
                            finishReason: 'stop',
                            message: {
                                role: 'assistant',
                                content: 'premature generic summary',
                            },
                            usage: { promptTokens: 14, completionTokens: 4, totalTokens: 18 },
                        };
                    }

                    if (providerCalls === 4) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'search-large-title',
                                    name: 'search_code',
                                    arguments: JSON.stringify({ path: targetPath, pattern: '<title>' }),
                                }],
                            },
                            usage: { promptTokens: 16, completionTokens: 2, totalTokens: 18 },
                        };
                    }

                    if (providerCalls === 5) {
                        callbacks.onToken?.('只有标题的浅层分析');
                        return {
                            finishReason: 'stop',
                            message: {
                                role: 'assistant',
                                content: '只有标题的浅层分析',
                            },
                            usage: { promptTokens: 18, completionTokens: 4, totalTokens: 22 },
                        };
                    }

                    if (providerCalls === 6) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'search-large-body',
                                    name: 'search_code',
                                    arguments: JSON.stringify({ path: targetPath, pattern: '<body' }),
                                }],
                            },
                            usage: { promptTokens: 20, completionTokens: 2, totalTokens: 22 },
                        };
                    }

                    if (providerCalls === 7) {
                        callbacks.onToken?.('只有 body 标签的浅层分析');
                        return {
                            finishReason: 'stop',
                            message: {
                                role: 'assistant',
                                content: '只有 body 标签的浅层分析',
                            },
                            usage: { promptTokens: 22, completionTokens: 4, totalTokens: 26 },
                        };
                    }

                    if (providerCalls === 8) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'search-large-structure',
                                    name: 'search_code',
                                    arguments: JSON.stringify({ path: targetPath, pattern: '<body|<script|function|id=' }),
                                }],
                            },
                            usage: { promptTokens: 24, completionTokens: 2, totalTokens: 26 },
                        };
                    }

                    callbacks.onToken?.('简洁分析：这是 Next 3 的移动端原型。');
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: '简洁分析：这是 Next 3 的移动端原型。',
                        },
                        usage: { promptTokens: 20, completionTokens: 8, totalTokens: 28 },
                    };
                },
            },
            session,
            userMessage,
            attachments: [],
            streamId: 'stream-large-file-analysis',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'mvp',
            maxIterations: 12,
            emit: (() => {}) as any,
            getToolDefinitions: () => [
                { name: 'read_file', description: 'Read a file', parameters: [] },
                { name: 'search_code', description: 'Search code', parameters: [] },
            ],
            executeToolCalls: async (toolCalls) => {
                const toolCall = toolCalls[0]!;
                const args = JSON.parse(toolCall.arguments);
                toolExecutions.push(`${toolCall.name}:${toolCall.id}`);

                if (toolCall.id === 'read-large-full') {
                    const error = 'File is too large to read fully (89756 bytes > 65536 bytes). Use startLine/endLine first.';
                    session.recordToolExecution({
                        id: toolCall.id,
                        name: toolCall.name,
                        args,
                        success: false,
                        output: `Error: ${error}`,
                        error,
                    });
                    session.addToolResult(toolCall.id, `Error: ${error}`);
                    return;
                }

                const output = toolCall.id === 'read-large-first-range'
                    ? '<!DOCTYPE html>\n<title>Next 3 — 每天三步</title>\n<style>.phone { width: 393px; }</style>'
                    : toolCall.id === 'search-large-title'
                        ? '6:<title>Next 3 — 每天三步</title>'
                    : toolCall.id === 'search-large-body'
                        ? '1657:<body>'
                    : '1432:<body>\n1988:<script>\n1991:function navigateTo(screenId) {';
                session.recordToolExecution({
                    id: toolCall.id,
                    name: toolCall.name,
                    args,
                    success: true,
                    output,
                });
                session.addToolResult(toolCall.id, output);
            },
            createRuntime: () => createMvpConversationRuntime({
                userGoal: userMessage,
                projectRoot: process.cwd(),
                session,
                runtimeProfile: 'mvp',
                runtimeConfig: {
                    baselineCheck: false,
                    distillVerifier: false,
                    stopConditions: {
                        hard: [],
                        soft: [],
                        maxLoops: 8,
                    },
                },
            }),
        })) {
            streamedEvents.push(event);
        }

        const assistantDeltaText = streamedEvents
            .filter((event) => event.type === 'message.delta')
            .map((event) => event.payload.text)
            .join('');
        const assistantCompletedText = streamedEvents
            .filter((event) => event.type === 'message.completed' && event.payload.message.role === 'assistant')
            .map((event) => event.payload.message.content)
            .join('');

        expect(providerCalls).toBe(9);
        expect(toolExecutions).toEqual([
            'read_file:read-large-full',
            'read_file:read-large-first-range',
            'search_code:search-large-title',
            'search_code:search-large-body',
            'search_code:search-large-structure',
        ]);
        expect(assistantDeltaText).not.toContain('premature generic summary');
        expect(assistantDeltaText).not.toContain('只有标题的浅层分析');
        expect(assistantDeltaText).not.toContain('只有 body 标签的浅层分析');
        expect(assistantDeltaText).not.toContain('简洁分析');
        expect(assistantCompletedText).toContain('简洁分析');
        expect(session.getMessages().some((message) => (
            message.role === 'assistant'
            && String(message.content).includes('premature generic summary')
        ))).toBe(false);
        expect(session.getMessages().some((message) => (
            message.role === 'assistant'
            && String(message.content).includes('只有标题的浅层分析')
        ))).toBe(false);
        expect(session.getMessages().some((message) => (
            message.role === 'assistant'
            && String(message.content).includes('只有 body 标签的浅层分析')
        ))).toBe(false);
    });

    it('runs the tool follow-up verification bridge before the next provider turn', async () => {
        const session = new AgentSession({ id: 'conversation-engine-follow-up', systemPrompt: 'system' });
        const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
        let verificationRuns = 0;

        const result = await runConversationEngine({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream(request) {
                    requests.push({
                        messages: request.messages.map((message) => ({
                            role: message.role,
                            content: String(message.content ?? ''),
                        })),
                    });
                    if (requests.length === 1) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'tool-call-bridge-1',
                                    name: 'write_file',
                                    arguments: '{"path":"src/index.ts"}',
                                }],
                            },
                            usage: {
                                promptTokens: 10,
                                completionTokens: 2,
                                totalTokens: 12,
                            },
                        };
                    }
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'verified result',
                        },
                        usage: {
                            promptTokens: 15,
                            completionTokens: 3,
                            totalTokens: 18,
                        },
                    };
                },
            },
            session,
            userMessage: 'fix and verify',
            attachments: [],
            streamId: 'stream-bridge',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'hybrid',
            maxIterations: 4,
            emit: (() => {}) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async (toolCalls) => {
                session.recordToolExecution({
                    id: toolCalls[0]!.id,
                    name: toolCalls[0]!.name,
                    args: { path: 'src/index.ts' },
                    success: true,
                    output: 'updated file',
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(toolCalls[0]!.id, 'updated file');
            },
            createRuntime: () => ({
                prepareMessages: () => session.getMessages(),
                async runPostToolVerification() {
                    verificationRuns += 1;
                    session.addMessage({
                        role: 'system',
                        content: 'Verification passed.',
                    });
                },
                getForcedStopMessage: () => undefined,
                getCompletionBlocker: () => undefined,
                getNoToolCompletionBlocker: () => undefined,
                finalizeAssistantResponse: (content) => content,
            }),
        });

        expect(result).toBe('verified result');
        expect(verificationRuns).toBe(1);
        expect(requests[1]!.messages.some((message) => message.role === 'system' && message.content.includes('Verification passed.'))).toBe(true);
    });

    it('emits a verification event when the tool follow-up bridge appends verification signals', async () => {
        const session = new AgentSession({ id: 'conversation-engine-verification-event', systemPrompt: 'system' });
        const verificationEvents: Array<{ ok: boolean; blocked: boolean; summary: string }> = [];
        let providerCalls = 0;

        const result = await runConversationEngine({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    providerCalls += 1;
                    if (providerCalls === 1) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'tool-call-verification-1',
                                    name: 'write_file',
                                    arguments: '{"path":"src/index.ts"}',
                                }],
                            },
                            usage: {
                                promptTokens: 11,
                                completionTokens: 2,
                                totalTokens: 13,
                            },
                        };
                    }

                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'verified',
                        },
                        usage: {
                            promptTokens: 12,
                            completionTokens: 3,
                            totalTokens: 15,
                        },
                    };
                },
            },
            session,
            userMessage: 'verify after write',
            attachments: [],
            streamId: 'stream-verification',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'hybrid',
            maxIterations: 4,
            emit: ((type, data) => {
                if (type === 'verification') {
                    verificationEvents.push(data as any);
                }
            }) as any,
            getToolDefinitions: () => [{
                name: 'write_file',
                description: 'Write a file',
                parameters: [],
            }],
            executeToolCalls: async (toolCalls) => {
                session.recordToolExecution({
                    id: toolCalls[0]!.id,
                    name: toolCalls[0]!.name,
                    args: { path: 'src/index.ts' },
                    success: true,
                    output: 'wrote src/index.ts',
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(toolCalls[0]!.id, 'wrote src/index.ts');
            },
            createRuntime: () => ({
                prepareMessages: () => session.getMessages(),
                async runPostToolVerification() {
                    session.addMessage({ role: 'system', content: 'Verification passed.' });
                },
                getForcedStopMessage: () => undefined,
                getCompletionBlocker: () => undefined,
                getNoToolCompletionBlocker: () => undefined,
                finalizeAssistantResponse: (content) => content,
            }),
        });

        expect(result).toBe('verified');
        expect(verificationEvents).toEqual([{
            ok: true,
            blocked: false,
            summary: 'Verification passed.',
        }]);
        expect(session.getVerificationHistory()).toEqual([{
            id: expect.any(String),
            ok: true,
            blocked: false,
            summary: 'Verification passed.',
            messages: ['Verification passed.'],
            createdAt: expect.any(Date),
        }]);
    });

    it('does not run runtime verification after a read-only tool batch in engineering_edit mode', async () => {
        const session = new AgentSession({ id: 'conversation-engine-read-only-batch', systemPrompt: 'system' });
        let providerCalls = 0;
        let verificationRuns = 0;

        const result = await runConversationEngine({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    providerCalls += 1;
                    if (providerCalls === 1) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'tool-call-read-only-batch',
                                    name: 'read_file',
                                    arguments: '{"path":"src/index.ts"}',
                                }],
                            },
                            usage: {
                                promptTokens: 9,
                                completionTokens: 2,
                                totalTokens: 11,
                            },
                        };
                    }

                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'read-only follow-up complete',
                        },
                        usage: {
                            promptTokens: 10,
                            completionTokens: 3,
                            totalTokens: 13,
                        },
                    };
                },
            },
            session,
            userMessage: 'inspect before fixing',
            attachments: [],
            streamId: 'stream-read-only-batch',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'hybrid',
            maxIterations: 4,
            emit: (() => {}) as any,
            taskMode: 'engineering_edit',
            getToolDefinitions: () => [],
            executeToolCalls: async (toolCalls) => {
                session.recordToolExecution({
                    id: toolCalls[0]!.id,
                    name: toolCalls[0]!.name,
                    args: { path: 'src/index.ts' },
                    success: true,
                    output: 'const value = 1;',
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(toolCalls[0]!.id, 'const value = 1;');
            },
            createRuntime: () => ({
                prepareMessages: () => session.getMessages(),
                async runPostToolVerification() {
                    verificationRuns += 1;
                    session.addMessage({ role: 'system', content: 'Verification should not run here.' });
                },
                getForcedStopMessage: () => undefined,
                getCompletionBlocker: () => undefined,
                getNoToolCompletionBlocker: () => undefined,
                finalizeAssistantResponse: (content) => content,
            }),
        });

        expect(result).toBe('read-only follow-up complete');
        expect(verificationRuns).toBe(0);
        expect(session.getVerificationHistory()).toEqual([]);
    });

    it('forces debug_fix turns to reproduce before the latest successful fix can complete', async () => {
        const session = new AgentSession({ id: 'conversation-engine-debug-fix', systemPrompt: 'system' });
        const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
        let providerCalls = 0;
        let verificationRuns = 0;

        const result = await runConversationEngine({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream(request) {
                    requests.push({
                        messages: request.messages.map((message) => ({
                            role: message.role,
                            content: String(message.content ?? ''),
                        })),
                    });
                    providerCalls += 1;

                    switch (providerCalls) {
                        case 1:
                            return {
                                finishReason: 'tool_calls',
                                message: {
                                    role: 'assistant',
                                    content: '',
                                    toolCalls: [{
                                        id: 'debug-fix-write-1',
                                        name: 'write_file',
                                        arguments: '{"path":"src/utils.ts"}',
                                    }],
                                },
                                usage: {
                                    promptTokens: 10,
                                    completionTokens: 2,
                                    totalTokens: 12,
                                },
                            };
                        case 2:
                            return {
                                finishReason: 'stop',
                                message: {
                                    role: 'assistant',
                                    content: '已修复，可以结束了。',
                                },
                                usage: {
                                    promptTokens: 11,
                                    completionTokens: 3,
                                    totalTokens: 14,
                                },
                            };
                        case 3:
                            return {
                                finishReason: 'tool_calls',
                                message: {
                                    role: 'assistant',
                                    content: '',
                                    toolCalls: [{
                                        id: 'debug-fix-repro',
                                        name: 'run_shell',
                                        arguments: '{"command":"bun test src/utils.test.ts"}',
                                    }],
                                },
                                usage: {
                                    promptTokens: 12,
                                    completionTokens: 2,
                                    totalTokens: 14,
                                },
                            };
                        case 4:
                            return {
                                finishReason: 'stop',
                                message: {
                                    role: 'assistant',
                                    content: '现在应该可以结束了。',
                                },
                                usage: {
                                    promptTokens: 12,
                                    completionTokens: 3,
                                    totalTokens: 15,
                                },
                            };
                        case 5:
                            return {
                                finishReason: 'tool_calls',
                                message: {
                                    role: 'assistant',
                                    content: '',
                                    toolCalls: [{
                                        id: 'debug-fix-write-2',
                                        name: 'write_file',
                                        arguments: '{"path":"src/utils.ts"}',
                                    }],
                                },
                                usage: {
                                    promptTokens: 12,
                                    completionTokens: 2,
                                    totalTokens: 14,
                                },
                            };
                        default:
                            return {
                                finishReason: 'stop',
                                message: {
                                    role: 'assistant',
                                    content: 'verified fix',
                                },
                                usage: {
                                    promptTokens: 13,
                                    completionTokens: 3,
                                    totalTokens: 16,
                                },
                            };
                    }
                },
            },
            session,
            userMessage: '修复 TypeError 并验证',
            attachments: [],
            streamId: 'stream-debug-fix',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'hybrid',
            maxIterations: 8,
            emit: (() => {}) as any,
            taskMode: 'debug_fix',
            getToolDefinitions: () => [],
            executeToolCalls: async (toolCalls) => {
                const toolCall = toolCalls[0]!;
                if (toolCall.name === 'write_file') {
                    session.recordToolExecution({
                        id: toolCall.id,
                        name: toolCall.name,
                        args: { path: 'src/utils.ts' },
                        success: true,
                        output: `patched via ${toolCall.id}`,
                        startedAt: new Date(),
                        completedAt: new Date(),
                    });
                    session.addToolResult(toolCall.id, `patched via ${toolCall.id}`);
                    return;
                }

                session.recordToolExecution({
                    id: toolCall.id,
                    name: toolCall.name,
                    args: { command: 'bun test src/utils.test.ts' },
                    success: false,
                    output: 'TypeError: Cannot read properties of undefined',
                    error: 'exit 1',
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(toolCall.id, 'TypeError: Cannot read properties of undefined');
            },
            createRuntime: () => ({
                prepareMessages: () => session.getMessages(),
                async runPostToolVerification() {
                    verificationRuns += 1;
                    session.addMessage({
                        role: 'system',
                        content: 'Runtime verification passed.',
                    });
                },
                getForcedStopMessage: () => undefined,
                getCompletionBlocker: () => undefined,
                getNoToolCompletionBlocker: () => undefined,
                finalizeAssistantResponse: (content) => content,
            }),
        });

        expect(result).toBe('verified fix');
        expect(providerCalls).toBe(6);
        expect(verificationRuns).toBe(2);
        expect(requests[2]!.messages.some((message) => message.content.includes('reproduce -> fix -> verify'))).toBe(true);
        expect(session.getMessages().filter((message) =>
            message.role === 'system' && String(message.content).includes('reproduce -> fix -> verify'),
        )).not.toHaveLength(0);
    });

    it('records tool-result renderer, transcript, and event-store projections into the session main chain', async () => {
        const session = new AgentSession({ id: 'conversation-engine-artifact-sink', systemPrompt: 'system' });
        let providerCalls = 0;

        const result = await runConversationEngine({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    providerCalls += 1;
                    if (providerCalls === 1) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'tool-call-artifact-1',
                                    name: 'write_file',
                                    arguments: '{"path":"src/artifact.ts"}',
                                }],
                            },
                            usage: {
                                promptTokens: 10,
                                completionTokens: 2,
                                totalTokens: 12,
                            },
                        };
                    }

                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'artifact projections captured',
                        },
                        usage: {
                            promptTokens: 11,
                            completionTokens: 3,
                            totalTokens: 14,
                        },
                    };
                },
            },
            session,
            userMessage: 'capture tool projections',
            attachments: [],
            streamId: 'stream-artifact-sink',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'hybrid',
            maxIterations: 4,
            emit: (() => {}) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async (toolCalls) => {
                session.recordToolExecution({
                    id: toolCalls[0]!.id,
                    name: toolCalls[0]!.name,
                    args: { path: 'src/artifact.ts' },
                    success: true,
                    output: 'artifact write complete',
                    startedAt: new Date('2026-04-22T14:10:00.000Z'),
                    completedAt: new Date('2026-04-22T14:10:01.000Z'),
                    metadata: {
                        path: 'src/artifact.ts',
                        changeType: 'write',
                        bytes: 18,
                        rollbackPointId: 'rollback_artifact',
                        timestamp: '2026-04-22T14:10:01.000Z',
                    },
                });
                session.addToolResult(toolCalls[0]!.id, 'artifact write complete');
            },
            createRuntime: () => ({
                prepareMessages: () => session.getMessages(),
                async runPostToolVerification() {},
                getForcedStopMessage: () => undefined,
                getCompletionBlocker: () => undefined,
                getNoToolCompletionBlocker: () => undefined,
                finalizeAssistantResponse: (content) => content,
            }),
        });

        expect(result).toBe('artifact projections captured');
        expect(session.getToolResultRendererEvents()).toEqual([{
            type: 'tool.output',
            sessionId: 'conversation-engine-artifact-sink',
            toolCallId: 'tool-call-artifact-1',
            toolName: 'write_file',
            output: 'artifact write complete',
            timestamp: new Date('2026-04-22T14:10:01.000Z').getTime(),
        }, {
            type: 'tool.completed',
            sessionId: 'conversation-engine-artifact-sink',
            toolCallId: 'tool-call-artifact-1',
            toolName: 'write_file',
            success: true,
            timestamp: new Date('2026-04-22T14:10:01.000Z').getTime() + 1,
        }]);
        expect(session.getToolResultTranscriptEntries()).toEqual([{
            type: 'tool',
            content: 'artifact write complete',
            toolCallId: 'tool-call-artifact-1',
            toolName: 'write_file',
            success: true,
        }]);
        expect(session.getToolResultEventStoreRecords()).toEqual([{
            type: 'tool_result',
            sessionId: 'conversation-engine-artifact-sink',
            toolCallId: 'tool-call-artifact-1',
            toolName: 'write_file',
            success: true,
            content: 'artifact write complete',
            timestamp: new Date('2026-04-22T14:10:01.000Z').getTime(),
        }]);
    });

});
