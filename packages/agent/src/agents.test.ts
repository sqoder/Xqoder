import { describe, expect, it } from 'vitest';
import { normalizeLLMConfig, type XQoderConfig } from '@xqoder/shared';
import {
    buildAgentConfigFromXQoderConfig,
    getBuiltInAgentDefinition,
    listBuiltInAgents,
    resolveAgentRuntimeConfig,
} from './agents.js';

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
        expect(config.systemPrompt).toContain('Summarize the recent session before compacting.');
        expect(config.llmConfig.model).toBe('gpt-4.1-mini');
    });
});
