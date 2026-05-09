import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { AgentSession } from '@xqoder/agent';
import {
    buildConversationTurnInput,
    buildChatTurnInput,
    prepareChatExecution,
} from '../../../src/application/chat/turn-intake.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('chat turn intake', () => {
    it('builds the standard ConversationTurnInput shape and keeps ChatTurnInput as a compatibility wrapper', () => {
        const cwd = createTempDir();
        const filePath = path.join(cwd, 'notes.md');

        const conversationTurn = buildConversationTurnInput({
            prompt: '/plan stabilize src/router.ts with test/router.test.ts',
            cwd,
            attachments: [{ type: 'file', filePath }],
            entrypoint: 'cli',
        });
        const chatTurn = buildChatTurnInput({
            prompt: '/plan stabilize src/router.ts with test/router.test.ts',
            cwd,
            attachments: [{ type: 'file', filePath }],
            entrypoint: 'cli',
        });

        expect(conversationTurn).toMatchObject({
            rawText: '/plan stabilize src/router.ts with test/router.test.ts',
            normalizedText: 'stabilize src/router.ts with test/router.test.ts',
            preparedText: expect.stringContaining('Mode: PLAN'),
            attachments: [{ type: 'file', filePath }],
            referencedFiles: ['notes.md', 'src/router.ts', 'test/router.test.ts'].map((entry) =>
                entry === 'notes.md' ? filePath : entry,
            ),
            slashCommand: {
                raw: '/plan',
                route: {
                    kind: 'workflow',
                    mode: 'plan',
                    input: 'stabilize src/router.ts with test/router.test.ts',
                },
            },
            cwd,
            entrypoint: 'cli',
            rawPrompt: '/plan stabilize src/router.ts with test/router.test.ts',
            preparedPrompt: expect.stringContaining('Mode: PLAN'),
            resolvedDir: cwd,
        });
        expect(chatTurn).toEqual(conversationTurn);
    });

    it('records the originating entrypoint for cli, tui, http, and headless turns', () => {
        const cwd = createTempDir();
        const entrypoints = ['cli', 'tui', 'http', 'headless'] as const;

        expect(entrypoints.map((entrypoint) => buildConversationTurnInput({
            prompt: 'hello',
            cwd,
            entrypoint,
        }).entrypoint)).toEqual(entrypoints);
    });

    it('normalizes attachments, output mode, explicit session intent, and runtime metadata', () => {
        const cwd = createTempDir();
        const filePath = path.join(cwd, 'notes.md');

        const turnInput = buildConversationTurnInput({
            prompt: '修复 src/utils.ts 的 TypeError',
            cwd,
            attachments: [{ type: 'file', filePath }],
            outputFormat: 'json',
            sessionId: 'session-123',
            entrypoint: 'headless',
        });

        expect(turnInput.cwd).toBe(cwd);
        expect(turnInput.resolvedDir).toBe(cwd);
        expect(turnInput.attachments).toEqual([{ type: 'file', filePath }]);
        expect(turnInput.outputFormat).toBe('json');
        expect(turnInput.sessionIntent).toEqual({
            mode: 'resume-explicit',
            sessionId: 'session-123',
        });
        expect(turnInput.runtime.interaction.kind).toBe('engineering_task');
        expect(turnInput.runtime.runtimeDecision.runtimeProfile).toBe('hybrid');
        expect(turnInput.preparedPrompt).toBe('修复 src/utils.ts 的 TypeError');
    });

    it('augments project explanation prompts and marks fresh sessions as new turns', () => {
        const cwd = createProjectDir();

        const turnInput = buildConversationTurnInput({
            prompt: '请解释这个项目',
            cwd,
            startNewSession: true,
            entrypoint: 'tui',
        });

        expect(turnInput.sessionIntent).toEqual({ mode: 'new' });
        expect(turnInput.runtime.interaction.kind).toBe('project_explanation');
        expect(turnInput.runtime.runtimeDecision.shouldAugmentProjectContext).toBe(true);
        expect(turnInput.preparedPrompt).toContain('[AutoProjectContext]');
        expect(turnInput.preparedPrompt).toContain('demo-project');
    });

    it('routes explicit local file path analysis without project-context injection or engineering report templates', () => {
        const cwd = createProjectDir();
        const externalHtml = path.join(os.tmpdir(), 'code.html');

        const turnInput = buildConversationTurnInput({
            prompt: `${externalHtml} 帮我分析一下这个项目`,
            cwd,
            entrypoint: 'tui',
        });

        expect(turnInput.runtime.interaction.kind).toBe('file_analysis');
        expect(turnInput.runtime.interaction.usesStructuredResponse).toBe(false);
        expect(turnInput.runtime.runtimeDecision.shouldAugmentProjectContext).toBe(false);
        expect(turnInput.preparedPrompt).not.toContain('[AutoProjectContext]');
    });

    it('captures resume-latest and stream-json output without forcing persistence', () => {
        const cwd = createTempDir();

        const turnInput = buildConversationTurnInput({
            prompt: '继续当前任务',
            cwd,
            outputFormat: 'stream-json',
            shouldPersistSession: false,
            entrypoint: 'http',
        });

        expect(turnInput.sessionIntent).toEqual({ mode: 'resume-latest' });
        expect(turnInput.outputFormat).toBe('stream-json');
        expect(turnInput.shouldPersistSession).toBe(false);
    });

    it('routes /plan through the shared workflow prompt and defaults to the planner agent', () => {
        const cwd = createTempDir();

        const turnInput = buildConversationTurnInput({
            prompt: '/plan stabilize the command router',
            cwd,
            entrypoint: 'cli',
        });

        expect(turnInput.agent).toBe('plan');
        expect(turnInput.runtime.commandRoute).toMatchObject({
            kind: 'workflow',
            mode: 'plan',
            input: 'stabilize the command router',
        });
        expect(turnInput.runtime.interaction.kind).toBe('engineering_task');
        expect(turnInput.runtime.runtimeDecision.runtimeProfile).toBe('hybrid');
        expect(turnInput.preparedPrompt).toContain('Mode: PLAN');
        expect(turnInput.preparedPrompt).toContain('User request: stabilize the command router');
    });

    it('routes /skill through a slash command prompt that loads the named skill tool', () => {
        const cwd = createTempDir();

        const turnInput = buildConversationTurnInput({
            prompt: '/skill code-review inspect src/router.ts',
            cwd,
            entrypoint: 'cli',
        });

        expect(turnInput.runtime.commandRoute).toEqual({
            kind: 'skill',
            name: 'code-review',
            input: 'inspect src/router.ts',
        });
        expect(turnInput.slashCommand).toMatchObject({
            raw: '/skill',
            route: {
                kind: 'skill',
                name: 'code-review',
            },
        });
        expect(turnInput.runtime.interaction.kind).toBe('engineering_task');
        expect(turnInput.normalizedText).toBe('inspect src/router.ts');
        expect(turnInput.preparedPrompt).toContain('Load the "code-review" skill with the skill tool');
        expect(turnInput.preparedPrompt).toContain('Goal: inspect src/router.ts');
        expect(turnInput.shouldPersistSession).toBe(true);
    });

    it('keeps slash skill commands in command routing instead of treating them as plain user text', () => {
        const cwd = createTempDir();

        const turnInput = buildConversationTurnInput({
            prompt: '/skill verification-loop check release readiness',
            cwd,
            entrypoint: 'http',
        });

        expect(turnInput.rawText).toBe('/skill verification-loop check release readiness');
        expect(turnInput.runtime.commandRoute).toEqual({
            kind: 'skill',
            name: 'verification-loop',
            input: 'check release readiness',
        });
        expect(turnInput.normalizedText).toBe('check release readiness');
        expect(turnInput.preparedPrompt).not.toBe('/skill verification-loop check release readiness');
        expect(turnInput.preparedPrompt).toContain('Load the "verification-loop" skill with the skill tool');
    });

    it('derives task mode, execution capability, and scoped approval policy from the turn route', () => {
        const cwd = createProjectDir();

        const planExecution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/plan stabilize the command router',
                cwd,
                entrypoint: 'cli',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
            },
        );
        const questionExecution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '请解释这个项目',
                cwd,
                entrypoint: 'cli',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
            },
        );
        const reviewExecution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/review inspect src/router.ts',
                cwd,
                entrypoint: 'cli',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
            },
        );
        const debugFixExecution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '修复 src/utils.ts 的 TypeError',
                cwd,
                entrypoint: 'cli',
            }),
            {
                configManager: {
                    load: () => createLoadedConfig('test-key', {
                        permissions: {
                            defaultMode: 'allow',
                            tools: {},
                        },
                    }),
                },
            },
        );
        const engineeringExecution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '为 src/utils.ts 新增 formatDate 辅助函数',
                cwd,
                entrypoint: 'cli',
            }),
            {
                configManager: {
                    load: () => createLoadedConfig('test-key', {
                        permissions: {
                            defaultMode: 'allow',
                            tools: {},
                        },
                    }),
                },
            },
        );

        expect(planExecution.agentConfig).toMatchObject({
            taskMode: 'plan_only',
            executionCapability: 'plan',
            approvalPolicy: 'strict',
            permissions: {
                approvalPolicy: 'strict',
                tools: {
                    edit: 'deny',
                    bash: 'deny',
                },
            },
        });
        expect(questionExecution.agentConfig).toMatchObject({
            taskMode: 'project_question',
            executionCapability: 'workspace_write',
            approvalPolicy: 'strict',
        });
        expect(reviewExecution.agentConfig).toMatchObject({
            taskMode: 'code_review',
            executionCapability: 'read_only',
            approvalPolicy: 'strict',
            permissions: {
                approvalPolicy: 'strict',
                tools: {
                    edit: 'deny',
                    bash: 'deny',
                },
            },
        });
        expect(debugFixExecution.agentConfig).toMatchObject({
            taskMode: 'debug_fix',
            executionCapability: 'workspace_write',
            approvalPolicy: 'workspace_auto',
            permissions: {
                approvalPolicy: 'workspace_auto',
                tools: {
                    edit: 'allow',
                },
            },
        });
        expect(engineeringExecution.agentConfig).toMatchObject({
            taskMode: 'engineering_edit',
            executionCapability: 'workspace_write',
            approvalPolicy: 'workspace_auto',
            permissions: {
                approvalPolicy: 'workspace_auto',
                tools: {
                    edit: 'allow',
                },
            },
        });
    });

    it('keeps natural-language file generation turns write-capable even without engineering regex hits', () => {
        const cwd = createProjectDir();

        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '在我的桌面上写一篇作文 100字的 格式为md',
                cwd,
                entrypoint: 'tui',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
            },
        );

        expect(execution.turnInput.runtime.interaction.kind).toBe('casual');
        expect(execution.agentConfig).toMatchObject({
            taskMode: 'casual_chat',
            executionCapability: 'workspace_write',
            approvalPolicy: 'strict',
        });
    });

    it('treats /status as a direct command without requiring persistence lookups', () => {
        const cwd = createTempDir();

        const turnInput = buildConversationTurnInput({
            prompt: '/status',
            cwd,
            requireSessionStore: true,
            entrypoint: 'http',
        });

        expect(turnInput.runtime.commandRoute).toEqual({ kind: 'status' });
        expect(turnInput.shouldPersistSession).toBe(false);
        expect(turnInput.requireSessionStore).toBe(false);
    });

    it('treats /permissions as a direct command without requiring persistence lookups', () => {
        const cwd = createTempDir();

        const turnInput = buildConversationTurnInput({
            prompt: '/permissions',
            cwd,
            requireSessionStore: true,
            entrypoint: 'cli',
        });

        expect(turnInput.runtime.commandRoute).toEqual({ kind: 'permissions' });
        expect(turnInput.shouldPersistSession).toBe(false);
        expect(turnInput.requireSessionStore).toBe(false);
    });

    it('treats /tools and /compact as shared direct commands without requiring persistence lookups', () => {
        const cwd = createTempDir();

        const toolsTurn = buildConversationTurnInput({
            prompt: '/tools',
            cwd,
            requireSessionStore: true,
            entrypoint: 'cli',
        });
        const compactTurn = buildConversationTurnInput({
            prompt: '/compact',
            cwd,
            requireSessionStore: true,
            entrypoint: 'tui',
        });

        expect(toolsTurn.runtime.commandRoute).toEqual({ kind: 'tools' });
        expect(toolsTurn.shouldPersistSession).toBe(false);
        expect(toolsTurn.requireSessionStore).toBe(false);
        expect(compactTurn.runtime.commandRoute).toEqual({ kind: 'compact' });
        expect(compactTurn.shouldPersistSession).toBe(false);
        expect(compactTurn.requireSessionStore).toBe(false);
    });

    it('reroutes /implement to /plan when the current session does not have a matching approved plan', () => {
        const cwd = createTempDir();
        const session = new AgentSession({ systemPrompt: 'system' });

        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/implement stabilize the command router',
                cwd,
                sessionId: session.id,
                entrypoint: 'cli',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
                sessionStore: {
                    findLatestSession: () => session,
                    getSession: () => session,
                    saveSession: () => ({ id: session.id }),
                },
            },
        );

        expect(execution.turnInput.runtime.commandRoute).toMatchObject({
            kind: 'workflow',
            mode: 'plan',
            input: 'stabilize the command router',
        });
        expect(execution.turnInput.preparedPrompt).toContain('Mode: PLAN');
        expect(execution.agentConfig.taskMode).toBe('plan_only');
        expect(session.getWorkflowState()).toBeUndefined();
    });

    it('allows /implement to enter engineering mode when the current session has a matching approved plan', () => {
        const cwd = createTempDir();
        const session = new AgentSession({ systemPrompt: 'system' });
        session.recordWorkflowState({
            kind: 'plan',
            rawGoal: 'stabilize the command router',
            normalizedGoal: 'stabilize the command router',
            completedAt: new Date('2026-04-23T00:00:00.000Z'),
            sourceTurnId: `${session.id}:turn:plan`,
        });

        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/implement stabilize the command router',
                cwd,
                sessionId: session.id,
                entrypoint: 'cli',
            }),
            {
                configManager: {
                    load: () => createLoadedConfig('test-key', {
                        permissions: {
                            defaultMode: 'allow',
                            tools: {},
                        },
                    }),
                },
                sessionStore: {
                    findLatestSession: () => session,
                    getSession: () => session,
                    saveSession: () => ({ id: session.id }),
                },
            },
        );

        expect(execution.turnInput.runtime.commandRoute).toEqual({
            kind: 'implement',
            input: 'stabilize the command router',
        });
        expect(execution.turnInput.preparedPrompt).toBe('stabilize the command router');
        expect(execution.agentConfig.taskMode).toBe('engineering_edit');
        expect(session.getWorkflowState()).toBeUndefined();
    });

    it('prepares execution by resolving the requested session and runtime profile', () => {
        const cwd = createTempDir();
        const explicitSession = { id: 'session-456' };

        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '你好',
                cwd,
                sessionId: 'session-456',
                entrypoint: 'cli',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
                sessionStore: {
                    findLatestSession: () => null,
                    getSession: (sessionId: string) => (sessionId === 'session-456' ? explicitSession as any : null),
                    saveSession: () => ({ id: 'unused' }),
                },
            },
        );

        expect(execution.agentConfig.session).toBe(explicitSession);
        expect(execution.agentConfig.runtimeProfile).toBe('mvp');
        expect(execution.turnInput.sessionIntent).toEqual({
            mode: 'resume-explicit',
            sessionId: 'session-456',
        });
    });

    it('requires a session store when the caller marks the turn as mandatory for persistence lookup', () => {
        const cwd = createTempDir();

        expect(() => prepareChatExecution(
            buildConversationTurnInput({
                prompt: 'hello',
                cwd,
                requireSessionStore: true,
                entrypoint: 'headless',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
            },
        )).toThrow('Session storage unavailable');
    });
});

function createLoadedConfig(
    apiKey: string,
    options: {
        provider?: 'openai' | 'local' | 'dashscope';
        model?: string;
        permissions?: {
            defaultMode?: 'allow' | 'ask' | 'deny' | 'auto' | 'plan';
            tools?: Record<string, 'allow' | 'ask' | 'deny' | 'auto' | 'plan'>;
            approvalPolicy?: 'strict' | 'balanced' | 'workspace_auto';
        };
    } = {},
) {
    const provider = options.provider ?? 'openai';
    const model = options.model ?? 'gpt-4.1';

    return {
        llm: {
            provider,
            model,
            apiKey,
        },
        providers: {
            [provider]: {
                apiKey,
                defaultModel: model,
                ...(provider === 'local'
                    ? { baseUrl: 'http://localhost:11434/v1' }
                    : {}),
            },
        },
        defaultAgent: 'general',
        agents: {
            general: {
                mode: 'primary',
                provider,
                model,
            },
        },
        sandbox: {
            mode: 'project',
            allowedPaths: [],
        },
        ...(options.permissions ? { permissions: options.permissions } : {}),
    };
}

function createProjectDir(): string {
    const cwd = createTempDir();
    fs.writeFileSync(path.join(cwd, 'README.md'), '# Demo Project\n\nA sample app.\n', 'utf-8');
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
        name: 'demo-project',
        description: 'Sample terminal app',
    }, null, 2));
    return cwd;
}

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-turn-intake-'));
    tempDirs.push(dir);
    return dir;
}
