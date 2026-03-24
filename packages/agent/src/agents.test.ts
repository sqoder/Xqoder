import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeLLMConfig, writeProjectMemoryFile, type ProjectMemorySnapshot, type XQoderConfig } from '@xqoder/shared';
import {
    buildAgentConfigFromXQoderConfig,
    getBuiltInAgentDefinition,
    listBuiltInAgents,
    resolveAgentRuntimeConfig,
} from './agents.js';
import { AgentSession } from './session/session.js';

function createConfig(): XQoderConfig {
    return {
        llm: normalizeLLMConfig({
            provider: 'openai',
            model: 'gpt-4.1',
            apiKey: 'openai-key',
        }),
        providers: {
            openai: {
                apiKey: 'openai-key',
                defaultModel: 'gpt-4.1',
            },
            anthropic: {
                apiKey: 'anthropic-key',
                defaultModel: 'claude-sonnet-4',
            },
        },
        defaultAgent: 'general',
        smallModel: {
            provider: 'openai',
            model: 'gpt-4.1-mini',
        },
        agents: {
            general: {
                mode: 'primary',
                provider: 'anthropic',
                model: 'claude-sonnet-4',
            },
            summary: {
                mode: 'subagent',
                useSmallModel: true,
                instructions: ['keep file paths and key decisions'],
            },
        },
        instructions: ['reply in Chinese', 'prefer concise answers'],
        sandbox: {
            mode: 'project',
            allowedPaths: ['/workspace/shared'],
        },
        shell: {
            path: '/bin/zsh',
            args: ['-l'],
        },
        compaction: {
            auto: true,
            prune: false,
        },
        mcp: { servers: [] },
        lsp: { servers: [] },
        debug: false,
        recentProjects: [],
    };
}

describe('agent catalog', () => {
    it('exposes the expected built-in agents', () => {
        const names = listBuiltInAgents().map((agent) => agent.name);

        expect(names).toEqual(expect.arrayContaining([
            'general',
            'coder',
            'plan',
            'explore',
            'summary',
            'title',
            'compaction',
        ]));
        expect(getBuiltInAgentDefinition('summary')?.mode).toBe('subagent');
    });

    it('resolves runtime config using the configured default agent and instructions', () => {
        const runtime = resolveAgentRuntimeConfig(createConfig());

        expect(runtime.name).toBe('general');
        expect(runtime.mode).toBe('primary');
        expect(runtime.llmConfig).toMatchObject({
            provider: 'anthropic',
            model: 'claude-sonnet-4',
            apiKey: 'anthropic-key',
        });
        expect(runtime.systemPrompt).toContain('reply in Chinese');
        expect(runtime.systemPrompt).toContain('prefer concise answers');
    });

    it('uses smallModel for agents that opt into it', () => {
        const runtime = resolveAgentRuntimeConfig(createConfig(), 'summary');

        expect(runtime.mode).toBe('subagent');
        expect(runtime.llmConfig).toMatchObject({
            provider: 'openai',
            model: 'gpt-4.1-mini',
            apiKey: 'openai-key',
        });
        expect(runtime.systemPrompt).toContain('keep file paths and key decisions');
    });

    it('builds an XQoderAgent config from product config and command-specific prompt appendix', () => {
        const config = buildAgentConfigFromXQoderConfig(createConfig(), {
            agentName: 'summary',
            cwd: '/workspace/project',
            projectRoot: '/workspace/project',
            promptAppendix: 'Summarize the recent session before compacting.',
        });

        expect(config.cwd).toBe('/workspace/project');
        expect(config.projectRoot).toBe('/workspace/project');
        expect(config.sandboxMode).toBe('project');
        expect(config.allowedPaths).toEqual(['/workspace/shared']);
        expect(config.shell).toEqual({
            path: '/bin/zsh',
            args: ['-l'],
        });
        expect(config.compaction).toEqual({
            auto: true,
            prune: false,
            reserved: undefined,
        });
        expect(config.systemPrompt).toContain('Summarize the recent session before compacting.');
        expect(config.llmConfig.model).toBe('gpt-4.1-mini');
    });

    it('injects persisted session metadata into the system prompt as project memory', () => {
        const session = new AgentSession({
            id: 'session-memory-test',
            messages: [
                { role: 'system', content: 'system' },
                { role: 'user', content: 'fix the runtime bug' },
            ],
            metadata: {
                compactSummary: '- 用户希望修复 runtime bug\n- 已确认从 daemon 路径进入',
                toolHistory: [{
                    id: 'tool-1',
                    name: 'read_file',
                    args: { path: '/workspace/project/packages/runtime/src/core/runtime-kernel.ts' },
                    success: true,
                    outputPreview: 'ok',
                    startedAt: new Date('2026-03-22T00:00:00.000Z'),
                    completedAt: new Date('2026-03-22T00:00:01.000Z'),
                }],
                commandHistory: [{
                    id: 'cmd-1',
                    command: 'pnpm test --filter runtime',
                    cwd: '/workspace/project',
                    success: false,
                    outputPreview: 'failed',
                    startedAt: new Date('2026-03-22T00:00:02.000Z'),
                    completedAt: new Date('2026-03-22T00:00:03.000Z'),
                }],
                fileChanges: [{
                    id: 'file-1',
                    path: '/workspace/project/packages/runtime/src/core/runtime-kernel.ts',
                    changeType: 'patch',
                    bytes: 256,
                    success: true,
                    timestamp: new Date('2026-03-22T00:00:04.000Z'),
                }],
                compactions: [],
            },
        });

        const config = buildAgentConfigFromXQoderConfig(createConfig(), {
            cwd: '/workspace/project',
            projectRoot: '/workspace/project',
            session,
            promptAppendix: 'Focus on the current runtime issue.',
        });

        expect(config.systemPrompt).toContain('Focus on the current runtime issue.');
        expect(config.systemPrompt).toContain('Project Memory:');
        expect(config.systemPrompt).toContain('Recent Session Summary:');
        expect(config.systemPrompt).toContain('pnpm test --filter runtime');
        expect(config.systemPrompt).toContain('runtime-kernel.ts');
        expect(config.systemPrompt).toContain('Recent Tool Usage:');
    });

    it('loads cross-session project memory from .xqoder/project-memory.json', () => {
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-project-memory-agent-'));
        const memory: ProjectMemorySnapshot = {
            version: 1,
            projectRoot,
            updatedAt: '2026-03-22T08:00:00.000Z',
            session: {
                sessionId: 'session-prev',
                updatedAt: '2026-03-22T08:00:00.000Z',
                compactSummary: '- 上一轮主要在修复 daemon reconnect',
                recentCommands: [{
                    command: 'pnpm verify:daemon:e2e',
                    success: true,
                }],
                recentFileChanges: [{
                    path: `${projectRoot}/packages/daemon/src/server.ts`,
                    changeType: 'patch',
                    success: true,
                }],
                recentTools: [{
                    name: 'read_file',
                    success: true,
                }],
            },
            workflow: {
                updatedAt: '2026-03-22T08:01:00.000Z',
                totalRuns: 5,
                successRate: 0.6,
                failureBuckets: [{
                    bucket: 'verification_compile_error',
                    count: 2,
                }],
                byFlow: [{
                    flow: 'fix',
                    count: 3,
                    successRate: 0.6667,
                }],
                automaticActionPromotionCandidates: [{
                    actionId: 'auto-install-dependency-v1',
                    bucket: 'runtime_dependency_missing',
                    count: 3,
                    successRate: 1,
                }],
            },
        };
        writeProjectMemoryFile(projectRoot, memory);

        const config = buildAgentConfigFromXQoderConfig(createConfig(), {
            cwd: projectRoot,
            projectRoot,
            promptAppendix: 'Continue the project work.',
        });

        expect(config.systemPrompt).toContain('Continue the project work.');
        expect(config.systemPrompt).toContain('Cross-Session Project Memory:');
        expect(config.systemPrompt).toContain('pnpm verify:daemon:e2e');
        expect(config.systemPrompt).toContain('verification_compile_error');
        expect(config.systemPrompt).toContain('auto-install-dependency-v1');
    });
});
