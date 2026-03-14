import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    ConfigManager,
    resolveAgentLLMConfig,
    resolveConfigWithEnvOverrides,
    resolveDefaultAgentName,
    resolveSmallModelConfig,
} from './config.js';
import { getDefaultBaseUrlForProvider, normalizeLLMConfig } from './llm.js';

const tempDirs: string[] = [];

function createTempConfigPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-config-'));
    tempDirs.push(dir);
    return path.join(dir, 'config.json');
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('ConfigManager', () => {
    it('returns defaults when the config file does not exist', () => {
        const manager = new ConfigManager(createTempConfigPath());

        expect(manager.load()).toMatchObject({
            llm: {
                provider: 'openai',
                model: 'gpt-4o',
                apiKey: '',
            },
            sandbox: {
                mode: 'project',
                allowedPaths: [],
            },
            mcp: {
                servers: [],
            },
            lsp: {
                servers: [],
            },
            tui: {
                mouseMode: 'terminal',
                scrollStep: 3,
            },
            contextPaths: [
                '.github/copilot-instructions.md',
                '.cursorrules',
                '.cursor/rules/',
                'CLAUDE.md',
                'CLAUDE.local.md',
                'opencode.md',
                'opencode.local.md',
                'OpenCode.md',
                'OpenCode.local.md',
                'OPENCODE.md',
                'OPENCODE.local.md',
            ],
            shell: {
                path: expect.any(String),
                args: ['-l'],
            },
            debug: false,
            recentProjects: [],
        });
    });

    it('persists partial updates and keeps default values', () => {
        const configPath = createTempConfigPath();
        const manager = new ConfigManager(configPath);

        manager.load();
        manager.update({
            llm: {
                provider: 'anthropic',
                model: 'claude-3-7-sonnet-latest',
                apiKey: 'test-key',
            },
            debug: true,
        });
        manager.save();

        const reloaded = new ConfigManager(configPath).load();

        expect(reloaded).toMatchObject({
            llm: {
                provider: 'anthropic',
                model: 'claude-3-7-sonnet-latest',
                apiKey: 'test-key',
                maxTokens: 4096,
                temperature: 0.1,
            },
            vercel: {},
            mcp: {
                servers: [],
            },
            lsp: {
                servers: [],
            },
            debug: true,
            recentProjects: [],
        });
    });

    it('save() sets config file mode to 0o600 on Unix (Day 30 secret)', () => {
        const configPath = createTempConfigPath();
        const manager = new ConfigManager(configPath);
        manager.load();
        manager.update({ debug: true });
        manager.save();
        if (process.platform !== 'win32') {
            const stat = fs.statSync(configPath);
            const mode = stat.mode & 0o777;
            expect(mode).toBe(0o600);
        }
    });

    it('normalizes DashScope defaults when provider is dashscope', () => {
        const llm = normalizeLLMConfig({
            provider: 'dashscope',
            apiKey: 'test-key',
        });

        expect(llm).toMatchObject({
            provider: 'dashscope',
            model: 'qwen-plus',
            apiKey: 'test-key',
            baseUrl: getDefaultBaseUrlForProvider('dashscope'),
            maxTokens: 4096,
            temperature: 0.1,
        });
    });

    it('persists nested vercel settings', () => {
        const configPath = createTempConfigPath();
        const manager = new ConfigManager(configPath);

        manager.load();
        manager.update({
            vercel: {
                scope: 'my-team',
            },
        });
        manager.save();

        const reloaded = new ConfigManager(configPath).load();

        expect(reloaded.vercel?.scope).toBe('my-team');
    });

    it('persists tui interaction settings and exposes them through helpers', () => {
        const configPath = createTempConfigPath();
        const manager = new ConfigManager(configPath);

        manager.load();
        manager.update({
            tui: {
                mouseMode: 'app',
                scrollStep: 6,
            },
        });
        manager.save();

        const reloadedManager = new ConfigManager(configPath);
        const reloaded = reloadedManager.load();

        expect(reloaded.tui).toEqual({
            mouseMode: 'app',
            scrollStep: 6,
        });
        expect(reloadedManager.getTuiSettings()).toEqual({
            mouseMode: 'app',
            scrollStep: 6,
        });
    });

    it('supports OpenCode-compatible config aliases for tui.theme and autoCompact', () => {
        const configPath = createTempConfigPath();
        fs.writeFileSync(configPath, JSON.stringify({
            tui: {
                theme: 'gruvbox',
            },
            autoCompact: false,
        }, null, 2));

        const loaded = new ConfigManager(configPath).load();

        expect(loaded.theme).toBe('gruvbox');
        expect(loaded.compaction).toEqual({
            auto: false,
            prune: false,
            reserved: undefined,
        });
    });

    it('persists normalized MCP server settings', () => {
        const configPath = createTempConfigPath();
        const manager = new ConfigManager(configPath);

        manager.load();
        manager.update({
            mcp: {
                servers: [
                    {
                        name: ' filesystem ',
                        command: ' node ',
                        args: [' server.js ', ' --project '],
                        env: {
                            API_KEY: 'secret',
                            ' ': 'ignored',
                        },
                        cwd: ' /workspace/demo ',
                    },
                ],
            },
        });
        manager.save();

        const reloaded = new ConfigManager(configPath).load();

        expect(reloaded.mcp?.servers).toEqual([
            {
                name: 'filesystem',
                transport: 'stdio',
                command: 'node',
                args: ['server.js', '--project'],
                env: {
                    API_KEY: 'secret',
                },
                cwd: '/workspace/demo',
                enabled: true,
                timeoutMs: 15000,
            },
        ]);
    });

    it('persists normalized LSP server settings', () => {
        const configPath = createTempConfigPath();
        const manager = new ConfigManager(configPath);

        manager.load();
        manager.update({
            lsp: {
                servers: [
                    {
                        name: ' pyright ',
                        command: ' node ',
                        args: [' pyright-langserver ', '--stdio '],
                        extensions: ['py', '.pyi', ' py '],
                        languageId: ' python ',
                        env: {
                            PYTHONPATH: '/workspace/demo',
                            ' ': 'ignored',
                        },
                        cwd: ' /workspace/demo ',
                    },
                ],
            },
        });
        manager.save();

        const reloaded = new ConfigManager(configPath).load();

        expect(reloaded.lsp?.servers).toEqual([
            {
                name: 'pyright',
                transport: 'stdio',
                command: 'node',
                args: ['pyright-langserver', '--stdio'],
                extensions: ['.py', '.pyi'],
                languageId: 'python',
                env: {
                    PYTHONPATH: '/workspace/demo',
                },
                cwd: '/workspace/demo',
                enabled: true,
                timeoutMs: 15000,
                initializationOptions: undefined,
            },
        ]);
    });

    it('persists normalized TCP LSP server settings', () => {
        const configPath = createTempConfigPath();
        const manager = new ConfigManager(configPath);

        manager.load();
        manager.update({
            lsp: {
                servers: [
                    {
                        name: ' ruby-lsp ',
                        transport: 'tcp',
                        host: ' localhost ',
                        port: 7658,
                        command: ' bundle ',
                        args: [' exec ', ' ruby-lsp '],
                        extensions: ['rb', 'rake', '.rb'],
                        languageId: ' ruby ',
                        env: {
                            BUNDLE_GEMFILE: '/workspace/demo/Gemfile',
                            ' ': 'ignored',
                        },
                        cwd: ' /workspace/demo ',
                    },
                ],
            },
        });
        manager.save();

        const reloaded = new ConfigManager(configPath).load();

        expect(reloaded.lsp?.servers).toEqual([
            {
                name: 'ruby-lsp',
                transport: 'tcp',
                host: 'localhost',
                port: 7658,
                command: 'bundle',
                args: ['exec', 'ruby-lsp'],
                extensions: ['.rb', '.rake'],
                languageId: 'ruby',
                env: {
                    BUNDLE_GEMFILE: '/workspace/demo/Gemfile',
                },
                cwd: '/workspace/demo',
                enabled: true,
                timeoutMs: 15000,
                initializationOptions: undefined,
            },
        ]);
    });

    it('applies environment overrides on top of saved config', () => {
        const resolved = resolveConfigWithEnvOverrides({
            llm: normalizeLLMConfig({
                provider: 'openai',
                apiKey: 'saved-key',
            }),
            defaultDeployTarget: undefined,
            vercel: {
                scope: 'saved-team',
            },
            mcp: {
                servers: [],
            },
            lsp: {
                servers: [],
            },
            debug: false,
            recentProjects: [],
        }, {
            XQODER_LLM_PROVIDER: 'dashscope',
            XQODER_LLM_API_KEY: 'env-key',
            XQODER_LLM_MODEL: 'qwen-max',
            XQODER_VERCEL_SCOPE: 'env-team',
            XQODER_DEBUG: 'true',
        });

        expect(resolved.config).toMatchObject({
            llm: {
                provider: 'dashscope',
                model: 'qwen-max',
                apiKey: 'env-key',
                baseUrl: getDefaultBaseUrlForProvider('dashscope'),
            },
            vercel: {
                scope: 'env-team',
            },
            debug: true,
        });
        expect(resolved.appliedEnvVars).toEqual([
            'XQODER_LLM_PROVIDER',
            'XQODER_LLM_MODEL',
            'XQODER_LLM_API_KEY',
            'XQODER_DEBUG',
            'XQODER_VERCEL_SCOPE',
        ]);
    });

    it('applies sandbox environment overrides on top of saved config', () => {
        const resolved = resolveConfigWithEnvOverrides({
            llm: normalizeLLMConfig({
                provider: 'openai',
                apiKey: 'saved-key',
            }),
            sandbox: {
                mode: 'project',
                allowedPaths: [],
            },
            vercel: {},
            mcp: {
                servers: [],
            },
            lsp: {
                servers: [],
            },
            debug: false,
            recentProjects: [],
        }, {
            XQODER_SANDBOX_MODE: 'full-access',
            XQODER_ALLOWED_PATHS: ['/Users/wangxinglin/Desktop', '/tmp/xqoder'].join(path.delimiter),
        });

        expect(resolved.config.sandbox).toEqual({
            mode: 'full-access',
            allowedPaths: ['/Users/wangxinglin/Desktop', '/tmp/xqoder'],
        });
        expect(resolved.appliedEnvVars).toEqual([
            'XQODER_SANDBOX_MODE',
            'XQODER_ALLOWED_PATHS',
        ]);
    });

    it('supports OPENCODE_DISABLE_AUTOCOMPACT as a compatibility env override', () => {
        const resolved = resolveConfigWithEnvOverrides({
            llm: normalizeLLMConfig({
                provider: 'openai',
                apiKey: 'saved-key',
            }),
            compaction: {
                auto: true,
                prune: false,
            },
            vercel: {},
            mcp: { servers: [] },
            lsp: { servers: [] },
            debug: false,
            recentProjects: [],
        }, {
            OPENCODE_DISABLE_AUTOCOMPACT: 'true',
        });

        expect(resolved.config.compaction).toEqual({
            auto: false,
            prune: false,
            reserved: undefined,
        });
        expect(resolved.appliedEnvVars).toContain('OPENCODE_DISABLE_AUTOCOMPACT');
    });

    it('lets XQODER_AUTO_COMPACT override OPENCODE compatibility value', () => {
        const resolved = resolveConfigWithEnvOverrides({
            llm: normalizeLLMConfig({
                provider: 'openai',
                apiKey: 'saved-key',
            }),
            compaction: {
                auto: false,
                prune: false,
            },
            vercel: {},
            mcp: { servers: [] },
            lsp: { servers: [] },
            debug: false,
            recentProjects: [],
        }, {
            OPENCODE_DISABLE_AUTOCOMPACT: 'true',
            XQODER_AUTO_COMPACT: 'true',
        });

        expect(resolved.config.compaction).toEqual({
            auto: true,
            prune: false,
            reserved: undefined,
        });
        expect(resolved.appliedEnvVars).toContain('OPENCODE_DISABLE_AUTOCOMPACT');
        expect(resolved.appliedEnvVars).toContain('XQODER_AUTO_COMPACT');
    });

    it('upgrades legacy llm config into providers and default agent metadata', () => {
        const configPath = createTempConfigPath();
        fs.writeFileSync(configPath, JSON.stringify({
            llm: {
                provider: 'anthropic',
                model: 'claude-3-7-sonnet-latest',
                apiKey: 'legacy-key',
                temperature: 0.2,
                maxTokens: 8192,
            },
        }, null, 2));

        const loaded = new ConfigManager(configPath).load();

        expect(loaded.providers?.anthropic).toEqual({
            apiKey: 'legacy-key',
            baseUrl: undefined,
            defaultModel: 'claude-3-7-sonnet-latest',
            disabled: false,
            maxTokens: 8192,
            temperature: 0.2,
        });
        expect(loaded.defaultAgent).toBe('general');
        expect(resolveDefaultAgentName(loaded)).toBe('general');
        expect(resolveAgentLLMConfig(loaded)).toMatchObject({
            provider: 'anthropic',
            model: 'claude-3-7-sonnet-latest',
            apiKey: 'legacy-key',
            maxTokens: 8192,
            temperature: 0.2,
        });
    });

    it('resolves default and named agents from provider and agent schema', () => {
        const loaded = new ConfigManager(createTempConfigPath());
        loaded.load();
        loaded.update({
            providers: {
                openai: {
                    apiKey: 'openai-key',
                    defaultModel: 'gpt-4.1',
                    temperature: 0.4,
                },
                anthropic: {
                    apiKey: 'anthropic-key',
                    defaultModel: 'claude-sonnet-4',
                },
            },
            defaultAgent: 'coder',
            smallModel: {
                provider: 'openai',
                model: 'gpt-4.1-mini',
            },
            agents: {
                coder: {
                    mode: 'primary',
                    provider: 'anthropic',
                    model: 'claude-sonnet-4',
                    temperature: 0.1,
                },
                summary: {
                    mode: 'subagent',
                    useSmallModel: true,
                },
            },
        });

        const config = loaded.get();

        expect(resolveDefaultAgentName(config)).toBe('coder');
        expect(resolveAgentLLMConfig(config)).toMatchObject({
            provider: 'anthropic',
            model: 'claude-sonnet-4',
            apiKey: 'anthropic-key',
            temperature: 0.1,
        });
        expect(resolveAgentLLMConfig(config, 'summary')).toMatchObject({
            provider: 'openai',
            model: 'gpt-4.1-mini',
            apiKey: 'openai-key',
        });
        expect(resolveSmallModelConfig(config)).toMatchObject({
            provider: 'openai',
            model: 'gpt-4.1-mini',
            apiKey: 'openai-key',
        });
    });

    it('applies env provider overrides through the default agent path', () => {
        const resolved = resolveConfigWithEnvOverrides({
            llm: normalizeLLMConfig({
                provider: 'openai',
                apiKey: 'saved-openai-key',
            }),
            providers: {
                openai: {
                    apiKey: 'saved-openai-key',
                    defaultModel: 'gpt-4o',
                },
            },
            defaultAgent: 'general',
            agents: {
                general: {
                    mode: 'primary',
                },
            },
            vercel: {},
            mcp: { servers: [] },
            lsp: { servers: [] },
            debug: false,
            recentProjects: [],
        }, {
            XQODER_LLM_PROVIDER: 'dashscope',
            XQODER_LLM_MODEL: 'qwen-max',
            XQODER_LLM_API_KEY: 'dashscope-key',
        });

        expect(resolveAgentLLMConfig(resolved.config)).toMatchObject({
            provider: 'dashscope',
            model: 'qwen-max',
            apiKey: 'dashscope-key',
        });
        expect(resolved.config.providers?.dashscope).toMatchObject({
            apiKey: 'dashscope-key',
            defaultModel: 'qwen-max',
        });
        expect(resolved.config.agents?.general?.provider).toBe('dashscope');
    });

    it('loads provider credential from credential directory override', () => {
        const configPath = createTempConfigPath();
        const manager = new ConfigManager(configPath);
        const loaded = manager.load({ mode: 'single' });
        const credentialDir = path.dirname(configPath);
        const credentialsPath = path.join(credentialDir, 'credentials');
        fs.mkdirSync(credentialsPath, { recursive: true });
        fs.writeFileSync(path.join(credentialsPath, 'openai.key'), 'secret-from-file', 'utf-8');

        const resolved = resolveConfigWithEnvOverrides(loaded, {}, {
            credentialDir,
        });

        expect(resolveAgentLLMConfig(resolved.config)).toMatchObject({
            provider: 'openai',
            apiKey: 'secret-from-file',
        });
        expect(resolved.appliedEnvVars).toContain('CREDENTIAL_FILE:openai');
    });

    it('merges global, xdg, project, and explicit config layers in priority order', () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-config-layers-'));
        tempDirs.push(rootDir);
        const homeDir = path.join(rootDir, 'home');
        const xdgConfigHome = path.join(rootDir, 'xdg');
        const projectDir = path.join(rootDir, 'workspace', 'demo', 'app');
        const explicitConfigPath = path.join(rootDir, 'explicit.json');

        fs.mkdirSync(path.join(homeDir, '.xqoder'), { recursive: true });
        fs.mkdirSync(path.join(xdgConfigHome, 'xqoder'), { recursive: true });
        fs.mkdirSync(path.join(projectDir, '.xqoder'), { recursive: true });

        fs.writeFileSync(path.join(homeDir, '.xqoder', 'config.json'), JSON.stringify({
            providers: {
                openai: {
                    apiKey: 'global-openai-key',
                    defaultModel: 'gpt-4o',
                },
            },
            instructions: ['global instruction'],
        }, null, 2));

        fs.writeFileSync(path.join(xdgConfigHome, 'xqoder', 'config.json'), JSON.stringify({
            providers: {
                openai: {
                    defaultModel: 'gpt-4.1',
                },
            },
        }, null, 2));

        fs.writeFileSync(path.join(projectDir, '.xqoder', 'config.json'), JSON.stringify({
            defaultAgent: 'coder',
            providers: {
                anthropic: {
                    apiKey: 'project-anthropic-key',
                    defaultModel: 'claude-sonnet-4',
                },
            },
            agents: {
                coder: {
                    mode: 'primary',
                    provider: 'anthropic',
                    model: 'claude-sonnet-4',
                },
            },
            instructions: ['project instruction'],
        }, null, 2));

        fs.writeFileSync(explicitConfigPath, JSON.stringify({
            smallModel: {
                provider: 'openai',
                model: 'gpt-4.1-mini',
            },
            permissions: {
                defaultMode: 'allow',
            },
            instructions: ['explicit instruction'],
        }, null, 2));

        const manager = new ConfigManager({
            homeDir,
            env: {
                XDG_CONFIG_HOME: xdgConfigHome,
            },
        });

        const loaded = manager.load({
            cwd: path.join(projectDir, 'src'),
            explicitConfigPath,
        });

        expect(loaded.providers?.openai).toMatchObject({
            apiKey: 'global-openai-key',
            defaultModel: 'gpt-4.1',
        });
        expect(loaded.providers?.anthropic).toMatchObject({
            apiKey: 'project-anthropic-key',
            defaultModel: 'claude-sonnet-4',
        });
        expect(loaded.defaultAgent).toBe('coder');
        expect(loaded.instructions).toEqual(['explicit instruction']);
        expect(loaded.permissions?.defaultMode).toBe('allow');
        expect(loaded.smallModel).toEqual({
            provider: 'openai',
            model: 'gpt-4.1-mini',
        });
        expect(resolveAgentLLMConfig(loaded)).toMatchObject({
            provider: 'anthropic',
            model: 'claude-sonnet-4',
            apiKey: 'project-anthropic-key',
        });
        expect(manager.getLoadMetadata().sources.filter((source) => source.exists)).toEqual([
            expect.objectContaining({ kind: 'global' }),
            expect.objectContaining({ kind: 'xdg' }),
            expect.objectContaining({ kind: 'project' }),
            expect.objectContaining({ kind: 'explicit' }),
        ]);
    });

    it('falls back to OpenCode project config and infers provider from agent model', () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-opencode-project-'));
        tempDirs.push(rootDir);
        const projectDir = path.join(rootDir, 'workspace', 'demo', 'app');
        fs.mkdirSync(projectDir, { recursive: true });

        fs.writeFileSync(path.join(projectDir, '.opencode.json'), JSON.stringify({
            providers: {
                anthropic: {
                    apiKey: 'anthropic-key',
                },
            },
            agents: {
                coder: {
                    model: 'claude-4-sonnet',
                    maxTokens: 5000,
                },
            },
        }, null, 2));

        const manager = new ConfigManager({
            homeDir: path.join(rootDir, 'home'),
            env: {},
        });

        const loaded = manager.load({
            cwd: path.join(projectDir, 'src'),
        });

        expect(loaded.defaultAgent).toBe('coder');
        expect(resolveAgentLLMConfig(loaded)).toMatchObject({
            provider: 'anthropic',
            model: 'claude-4-sonnet',
            apiKey: 'anthropic-key',
            maxTokens: 5000,
        });
        expect(manager.getLoadMetadata().sources.filter((source) => source.exists)).toEqual([
            expect.objectContaining({
                kind: 'project',
                path: path.join(projectDir, '.opencode.json'),
            }),
        ]);
    });
});
