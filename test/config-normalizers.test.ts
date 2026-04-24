import { describe, expect, it } from 'bun:test';
import {
    mergeXQoderConfig,
    normalizeXQoderConfig,
} from '../src/infra/shared/config-normalizers.js';

describe('config normalizer helpers', () => {
    it('merges nested config fragments without mutating the base config', () => {
        const base = normalizeXQoderConfig({
            providers: {
                openai: {
                    apiKey: 'base-key',
                    defaultModel: 'gpt-4o-mini',
                },
            },
            permissions: {
                defaultMode: 'allow',
                tools: {
                    read: 'allow',
                },
            },
            hooks: {
                PreToolUse: [
                    {
                        hooks: [
                            { type: 'command', command: 'echo base' },
                        ],
                    },
                ],
            },
            plugins: {
                enabled: ['base-plugin'],
            },
        });

        const merged = mergeXQoderConfig(base, {
            providers: {
                openai: {
                    baseUrl: 'https://example.test/v1',
                },
            },
            permissions: {
                tools: {
                    write: 'deny',
                },
            },
            hooks: {
                PreToolUse: [
                    {
                        hooks: [
                            { type: 'command', command: 'echo override' },
                        ],
                    },
                ],
            },
            plugins: {
                enabled: ['override-plugin'],
                disabled: ['legacy-plugin'],
            },
        });

        expect(base.providers.openai?.baseUrl).toBeUndefined();
        expect(base.permissions.tools?.write).toBeUndefined();
        expect(base.hooks.PreToolUse).toHaveLength(1);
        expect(base.plugins.enabled).toEqual(['base-plugin']);

        expect(merged.providers.openai?.apiKey).toBe('base-key');
        expect(merged.providers.openai?.baseUrl).toBe('https://example.test/v1');
        expect(merged.permissions.approvalPolicy).toBe('workspace_auto');
        expect(merged.permissions.tools?.read).toBe('allow');
        expect(merged.permissions.tools?.write).toBe('deny');
        expect(merged.hooks.PreToolUse).toHaveLength(2);
        expect(merged.plugins.enabled).toEqual(['override-plugin']);
        expect(merged.plugins.disabled).toEqual(['legacy-plugin']);
    });

    it('omits undefined optional config fields during normalization', () => {
        const normalized = normalizeXQoderConfig({
            hooks: {
                PreToolUse: [
                    {
                        hooks: [
                            { type: 'command', command: 'echo hi' },
                        ],
                    },
                ],
            },
            providers: {
                openai: {
                    apiKey: 'base-key',
                },
            },
            smallModel: {
                model: 'gpt-4o-mini',
            },
        });

        expect('theme' in normalized).toBe(false);
        expect('baseUrl' in normalized.providers.openai!).toBe(false);
        expect('provider' in normalized.smallModel!).toBe(false);
        expect('matcher' in normalized.hooks.PreToolUse![0]!).toBe(false);
        expect('shell' in normalized.hooks.PreToolUse![0]!.hooks[0]!).toBe(false);
        expect('timeout' in normalized.hooks.PreToolUse![0]!.hooks[0]!).toBe(false);
    });

    it('normalizes split domain settings without materializing undefined optional fields', () => {
        const normalized = normalizeXQoderConfig({
            providers: {
                anthropic: {
                    apiKey: '  domain-key  ',
                    baseUrl: '   ',
                    maxTokens: Number.NaN,
                },
            },
            disabledProviders: [],
            agents: {
                ' coder ': {
                    model: ' gpt-4o ',
                    prompt: '   ',
                    cwd: '   ',
                    instructions: [' keep this ', '   '],
                    tools: [' read ', '   '],
                },
            },
            mcp: {
                servers: [
                    {
                        name: ' docs ',
                        transport: 'http',
                        url: ' https://mcp.example.test ',
                    },
                ],
            },
            formatter: {
                command: ' prettier ',
                args: [' --write ', '   '],
                extensions: ['ts', ' .tsx ', '   '],
            },
        });

        expect(normalized.providers.anthropic?.apiKey).toBe('domain-key');
        expect('baseUrl' in normalized.providers.anthropic!).toBe(false);
        expect('maxTokens' in normalized.providers.anthropic!).toBe(false);
        expect('disabledProviders' in normalized).toBe(false);
        expect(normalized.agents?.coder?.instructions).toEqual(['keep this']);
        expect(normalized.agents?.coder?.tools).toEqual(['read']);
        expect('prompt' in normalized.agents!.coder!).toBe(false);
        expect('cwd' in normalized.agents!.coder!).toBe(false);
        expect('command' in normalized.mcp.servers[0]!).toBe(false);
        expect('cwd' in normalized.mcp.servers[0]!).toBe(false);
        expect(normalized.formatter).toEqual({
            command: 'prettier',
            args: ['--write'],
            extensions: ['.ts', '.tsx'],
        });
    });

    it('defaults MCP trust by transport while preserving explicit overrides', () => {
        const normalized = normalizeXQoderConfig({
            mcp: {
                servers: [
                    {
                        name: 'local-docs',
                        command: 'node',
                        args: ['server.js'],
                    },
                    {
                        name: 'remote-docs',
                        transport: 'http',
                        url: 'https://mcp.example.test',
                    },
                    {
                        name: 'bridge',
                        transport: 'sse',
                        url: 'https://bridge.example.test',
                        trust: 'trusted',
                    },
                ],
            },
        });

        expect(normalized.mcp.servers.map((server) => server.trust)).toEqual([
            'trusted',
            'untrusted',
            'trusted',
        ]);
    });

    it('treats url-backed MCP servers as remote even when transport is omitted', () => {
        const normalized = normalizeXQoderConfig({
            mcp: {
                servers: [
                    {
                        name: 'implicit-remote',
                        url: ' https://mcp.example.test ',
                    },
                ],
            },
        });

        expect(normalized.mcp.servers[0]).toMatchObject({
            name: 'implicit-remote',
            transport: 'http',
            url: 'https://mcp.example.test',
            trust: 'untrusted',
        });
        expect('command' in normalized.mcp.servers[0]!).toBe(false);
    });

    it('honors merge precedence while preserving base nested settings', () => {
        const base = normalizeXQoderConfig({
            providers: {
                openai: {
                    apiKey: 'base-key',
                    defaultModel: 'base-model',
                },
            },
            agents: {
                coder: {
                    model: 'base-agent-model',
                    tools: ['read'],
                },
            },
            hooks: {
                PreToolUse: [
                    {
                        matcher: 'Read',
                        hooks: [{ type: 'command', command: 'echo base' }],
                    },
                ],
            },
            mcp: {
                servers: [
                    { name: 'base-mcp', command: 'node', args: ['base.js'] },
                ],
            },
            lsp: {
                servers: [
                    { name: 'base-lsp', extensions: ['ts'], command: 'typescript-language-server' },
                ],
            },
            plugins: {
                enabled: ['base-plugin'],
                paths: ['/base/plugins'],
            },
        });

        const merged = mergeXQoderConfig(base, {
            providers: {
                openai: {
                    defaultModel: 'override-model',
                    temperature: 0.2,
                },
            },
            agents: {
                coder: {
                    model: 'override-agent-model',
                },
            },
            hooks: {
                PreToolUse: [
                    {
                        matcher: 'Write',
                        hooks: [{ type: 'command', command: 'echo override' }],
                    },
                ],
            },
            mcp: {
                servers: [
                    { name: 'override-mcp', transport: 'http', url: 'https://mcp.example.test' },
                ],
            },
            lsp: {
                servers: [
                    { name: 'override-lsp', transport: 'tcp', extensions: ['py'], host: '127.0.0.2', port: 9000 },
                ],
            },
            plugins: {
                allowIncompatible: true,
            },
        });

        expect(merged.providers.openai?.apiKey).toBe('base-key');
        expect(merged.providers.openai?.defaultModel).toBe('override-model');
        expect(merged.providers.openai?.temperature).toBe(0.2);
        expect(merged.agents?.coder?.model).toBe('override-agent-model');
        expect(merged.agents?.coder?.tools).toEqual(['read']);
        expect(merged.hooks.PreToolUse?.map(group => group.matcher)).toEqual(['Read', 'Write']);
        expect(merged.mcp.servers).toHaveLength(1);
        expect(merged.mcp.servers[0]?.name).toBe('override-mcp');
        expect(merged.lsp.servers).toHaveLength(1);
        expect(merged.lsp.servers[0]).toMatchObject({
            name: 'override-lsp',
            transport: 'tcp',
            host: '127.0.0.2',
            port: 9000,
            extensions: ['.py'],
        });
        expect(merged.plugins.enabled).toEqual(['base-plugin']);
        expect(merged.plugins.paths).toEqual(['/base/plugins']);
        expect(merged.plugins.allowIncompatible).toBe(true);
    });

    it('normalizes approval policy and tool allow/deny lists in permission settings', () => {
        const normalized = normalizeXQoderConfig({
            permissions: {
                defaultMode: 'allow',
                approvalPolicy: 'workspace_auto',
                allowedTools: [' read_file ', '  '],
                disallowedTools: [' bash ', ''],
                tools: {
                    edit: 'ask',
                },
            },
        });

        expect(normalized.permissions).toEqual({
            defaultMode: 'allow',
            approvalPolicy: 'workspace_auto',
            allowedTools: ['read_file'],
            disallowedTools: ['bash'],
            tools: {
                edit: 'ask',
            },
        });
    });
});
