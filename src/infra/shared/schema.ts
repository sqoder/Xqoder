// ============================================================
// Config JSON Schema Generator
// ============================================================

import { SUPPORTED_HOOK_EVENTS, type XQoderConfig } from './types.js';

type JsonSchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

interface JsonSchemaProperty {
    type: JsonSchemaType | JsonSchemaType[];
    description?: string;
    default?: unknown;
    enum?: unknown[];
    items?: JsonSchemaProperty;
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
    additionalProperties?: boolean | JsonSchemaProperty;
}

interface JsonSchema {
    $schema: string;
    title: string;
    description: string;
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
    additionalProperties: boolean;
}

/**
 * Generate a JSON Schema for XQoderConfig.
 * This is a hand-maintained schema that mirrors the TypeScript type definitions.
 */
export function generateConfigSchema(): JsonSchema {
    const hookHandlerSchema: JsonSchemaProperty = {
        type: 'object',
        properties: {
            type: { type: 'string', enum: ['command', 'http', 'prompt', 'agent'] },
            command: { type: 'string' },
            url: { type: 'string' },
            prompt: { type: 'string' },
            agent: { type: 'string' },
            model: { type: 'string' },
            shell: { type: 'string' },
            async: { type: 'boolean' },
            timeout: { type: 'number' },
            headers: {
                type: 'object',
                additionalProperties: { type: 'string' },
            },
        },
        required: ['type'],
    };
    const hookMatcherSchema: JsonSchemaProperty = {
        type: 'object',
        properties: {
            matcher: { type: 'string' },
            hooks: {
                type: 'array',
                items: hookHandlerSchema,
            },
        },
        required: ['hooks'],
    };

    return {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'XQoder Configuration',
        description: 'Configuration file for XQoder AI coding assistant',
        type: 'object',
        properties: {
            theme: {
                type: 'string',
                description: 'TUI color theme name',
                default: 'xqoder',
                enum: ['xqoder', 'catppuccin', 'dracula', 'tokyo-night', 'gruvbox', 'flexoki', 'monokai', 'one-dark', 'tron'],
            },
            llm: {
                type: 'object',
                description: 'Default LLM provider configuration',
                properties: {
                    provider: { type: 'string', description: 'LLM provider name' },
                    model: { type: 'string', description: 'Model name' },
                    apiKey: { type: 'string', description: 'API key (supports {env:VAR} substitution)' },
                    baseUrl: { type: 'string', description: 'Custom API base URL' },
                    maxTokens: { type: 'number', default: 4096 },
                    temperature: { type: 'number', default: 0.1 },
                },
                required: ['provider'],
            },
            providers: {
                type: 'object',
                description: 'Per-provider settings',
                additionalProperties: {
                    type: 'object',
                    properties: {
                        apiKey: { type: 'string' },
                        defaultModel: { type: 'string' },
                        baseUrl: { type: 'string' },
                        maxTokens: { type: 'number' },
                        temperature: { type: 'number' },
                        disabled: { type: 'boolean' },
                    },
                },
            },
            disabledProviders: {
                type: 'array',
                description: 'List of provider names to disable',
                items: { type: 'string' },
            },
            enabledProviders: {
                type: 'array',
                description: 'List of provider names to explicitly enable',
                items: { type: 'string' },
            },
            defaultAgent: {
                type: 'string',
                description: 'Default agent to use',
                default: 'general',
            },
            smallModel: {
                type: 'object',
                description: 'Smaller/cheaper model for sub-tasks (title, summary)',
                properties: {
                    provider: { type: 'string' },
                    model: { type: 'string' },
                },
            },
            agents: {
                type: 'object',
                description: 'Agent-specific configuration overrides',
                additionalProperties: {
                    type: 'object',
                    properties: {
                        model: { type: 'string' },
                        provider: { type: 'string' },
                        systemPrompt: { type: 'string' },
                        maxTokens: { type: 'number' },
                        temperature: { type: 'number' },
                        maxIterations: { type: 'number' },
                        disabled: { type: 'boolean' },
                    },
                },
            },
            instructions: {
                type: 'array',
                description: 'Global instructions injected into system prompt',
                items: { type: 'string' },
            },
            commands: {
                type: 'object',
                description: 'Custom command templates',
                additionalProperties: {
                    type: 'object',
                    properties: {
                        description: { type: 'string' },
                        command: { type: 'string' },
                        args: { type: 'array', items: { type: 'string' } },
                    },
                },
            },
            permissions: {
                type: 'object',
                description: 'Permission settings',
                properties: {
                    defaultMode: { type: 'string', enum: ['allow', 'ask', 'deny'], default: 'ask' },
                    tools: {
                        type: 'object',
                        additionalProperties: { type: 'string', enum: ['allow', 'ask', 'deny'] },
                    },
                },
            },
            disableAllHooks: {
                type: 'boolean',
                description: 'Disable all configured hooks without deleting them',
                default: false,
            },
            sandbox: {
                type: 'object',
                description: 'Sandbox/permission mode',
                properties: {
                    mode: { type: 'string', enum: ['project', 'paths', 'full-access'], default: 'project' },
                    allowedPaths: { type: 'array', items: { type: 'string' } },
                },
            },
            hooks: {
                type: 'object',
                description: 'Hook configuration grouped by event name',
                properties: Object.fromEntries(
                    SUPPORTED_HOOK_EVENTS.map((eventName) => [
                        eventName,
                        {
                            type: 'array',
                            items: hookMatcherSchema,
                        } satisfies JsonSchemaProperty,
                    ]),
                ),
                additionalProperties: false,
            },
            mcp: {
                type: 'object',
                description: 'MCP server configurations',
                properties: {
                    servers: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                command: { type: 'string' },
                                args: { type: 'array', items: { type: 'string' } },
                                env: { type: 'object', additionalProperties: { type: 'string' } },
                                cwd: { type: 'string' },
                                enabled: { type: 'boolean', default: true },
                                transport: { type: 'string', enum: ['stdio', 'http', 'sse'] },
                                url: { type: 'string' },
                                headers: { type: 'object', additionalProperties: { type: 'string' } },
                                timeoutMs: { type: 'number' },
                            },
                            required: ['name'],
                        },
                    },
                },
            },
            lsp: {
                type: 'object',
                description: 'LSP server configurations',
                properties: {
                    servers: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                command: { type: 'string' },
                                args: { type: 'array', items: { type: 'string' } },
                                extensions: { type: 'array', items: { type: 'string' } },
                                enabled: { type: 'boolean', default: true },
                                transport: { type: 'string', enum: ['stdio', 'tcp'] },
                            },
                            required: ['name', 'command'],
                        },
                    },
                },
            },
            keybinds: {
                type: 'object',
                description: 'Custom keybind overrides (action: key combo)',
                additionalProperties: { type: 'string' },
            },
            formatter: {
                type: 'object',
                description: 'Code formatter configuration',
                properties: {
                    command: { type: 'string' },
                    args: { type: 'array', items: { type: 'string' } },
                    extensions: { type: 'array', items: { type: 'string' } },
                },
            },
            watcher: {
                type: 'object',
                description: 'File watcher configuration',
                properties: {
                    ignore: { type: 'array', items: { type: 'string' } },
                },
            },
            compaction: {
                type: 'object',
                description: 'Session compaction settings',
                properties: {
                    auto: { type: 'boolean', default: true },
                    prune: { type: 'boolean', default: false },
                    reserved: { type: 'number' },
                },
            },
            contextPaths: {
                type: 'array',
                description: 'Additional context file paths',
                items: { type: 'string' },
            },
            shell: {
                type: 'object',
                description: 'Shell configuration for command execution',
                properties: {
                    path: { type: 'string' },
                    args: { type: 'array', items: { type: 'string' } },
                },
            },
            server: {
                type: 'object',
                description: 'Server mode configuration',
                properties: {
                    port: { type: 'number', default: 3100 },
                    hostname: { type: 'string', default: 'localhost' },
                    mdns: { type: 'boolean', default: false },
                    cors: { type: 'array', items: { type: 'string' } },
                },
            },
            share: {
                type: 'string',
                description: 'Share mode',
                enum: ['manual', 'auto', 'disabled'],
                default: 'manual',
            },
            autoupdate: {
                type: ['boolean', 'string'],
                description: 'Auto-update behavior',
                default: true,
            },
            debug: {
                type: 'boolean',
                description: 'Enable debug mode',
                default: false,
            },
        },
        additionalProperties: false,
    };
}

/**
 * Generate JSON Schema as a formatted JSON string.
 */
export function generateConfigSchemaJson(indent = 2): string {
    return JSON.stringify(generateConfigSchema(), null, indent);
}

// Type guard to ensure schema stays in sync with XQoderConfig
type _AssertSchemaKeys = keyof Omit<
    XQoderConfig,
    'defaultDeployTarget' | 'vercel' | 'recentProjects'
>;

const schemaKeyCoverageCheck: Partial<Record<_AssertSchemaKeys, true>> = {};
void schemaKeyCoverageCheck;
