import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import type { XQoderConfig } from '@xqoder/shared';
import {
    buildAgentConfigFromXQoderConfig,
    getMarkdownAgentDefinition,
    listMarkdownAgents,
    resolveAgentRuntimeConfig,
} from '../../src/core/agent/index.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('markdown agent compatibility', () => {
    it('discovers Claude-compatible markdown agents and projects tool limits into runtime permissions', () => {
        const cwd = createTempDir();
        const agentPath = path.join(cwd, '.claude', 'agents', 'repo-explorer.md');
        fs.mkdirSync(path.dirname(agentPath), { recursive: true });
        fs.writeFileSync(agentPath, [
            '---',
            'description: Explore repository structure',
            'tools:',
            '  - read_file',
            '  - grep_content',
            'disallowedTools:',
            '  - run_shell',
            'permissionMode: ask',
            'model: gpt-4.1-mini',
            '---',
            'Focus on read-only exploration and summarize concrete findings.',
            '',
        ].join('\n'), 'utf-8');

        const config = createConfig();
        const markdownAgent = getMarkdownAgentDefinition('repo-explorer', cwd);
        const discovered = listMarkdownAgents(cwd);
        const runtime = resolveAgentRuntimeConfig(config, 'repo-explorer', { cwd });
        const agentConfig = buildAgentConfigFromXQoderConfig(config, {
            agentName: 'repo-explorer',
            cwd,
        });

        expect(markdownAgent).toMatchObject({
            name: 'repo-explorer',
            mode: 'subagent',
            source: 'project-markdown',
            tools: ['read_file', 'grep_content'],
            disallowedTools: ['run_shell'],
            permissionMode: 'ask',
            model: 'gpt-4.1-mini',
        });
        expect(discovered.map((agent) => agent.name)).toContain('repo-explorer');
        expect(runtime).toMatchObject({
            name: 'repo-explorer',
            mode: 'subagent',
            tools: ['read_file', 'grep_content'],
            disallowedTools: ['run_shell'],
            permissionMode: 'ask',
        });
        expect(runtime.systemPrompt).toContain('Focus on read-only exploration');
        expect(agentConfig.permissions?.defaultMode).toBe('ask');
        expect(agentConfig.permissions?.allowedTools).toEqual(['read_file', 'grep_content']);
        expect(agentConfig.permissions?.disallowedTools).toContain('run_shell');
    });

    it('applies markdown permissionMode as the runtime permission default', () => {
        const cwd = createTempDir();
        const agentPath = path.join(cwd, '.claude', 'agents', 'reviewer.md');
        fs.mkdirSync(path.dirname(agentPath), { recursive: true });
        fs.writeFileSync(agentPath, [
            '---',
            'description: Read-only reviewer',
            'permissionMode: deny',
            '---',
            'Review the repository without executing tools unless explicitly configured.',
            '',
        ].join('\n'), 'utf-8');

        const agentConfig = buildAgentConfigFromXQoderConfig(createConfig(), {
            agentName: 'reviewer',
            cwd,
        });

        expect(agentConfig.permissions?.defaultMode).toBe('deny');
    });
});

function createConfig(overrides: Partial<XQoderConfig> = {}): XQoderConfig {
    return {
        llm: {
            provider: 'openai',
            model: 'gpt-4.1',
            apiKey: 'test-key',
        },
        providers: {
            openai: {
                apiKey: 'test-key',
                defaultModel: 'gpt-4.1',
            },
        },
        defaultAgent: 'general',
        agents: {
            general: {
                mode: 'primary',
                provider: 'openai',
                model: 'gpt-4.1',
            },
        },
        sandbox: {
            mode: 'project',
            allowedPaths: [],
        },
        ...overrides,
    };
}

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-markdown-agent-compat-'));
    tempDirs.push(dir);
    return dir;
}
