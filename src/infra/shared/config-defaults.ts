import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeLLMConfig } from './llm.js';
import { getXQoderPaths } from './paths.js';
import type { LLMProviderConfig, XQoderConfig } from './types.js';

const CONFIG_FILE = getXQoderPaths().configFile;

export const DEFAULT_LLM_CONFIG: LLMProviderConfig = normalizeLLMConfig({
    provider: 'openai',
});

export const DEFAULT_CONTEXT_PATHS = [
    '.github/copilot-instructions.md',
    '.cursorrules',
    '.cursor/rules/',
    'CLAUDE.md',
    'CLAUDE.local.md',
    'xqoder.md',
    'xqoder.local.md',
];

export function createDefaultConfig(env: NodeJS.ProcessEnv = process.env): XQoderConfig {
    const shellPath = env['SHELL']?.trim() || '/bin/bash';
    const openaiProvider = {
        apiKey: '',
        defaultModel: DEFAULT_LLM_CONFIG.model,
        ...(DEFAULT_LLM_CONFIG.baseUrl !== undefined ? { baseUrl: DEFAULT_LLM_CONFIG.baseUrl } : {}),
        ...(DEFAULT_LLM_CONFIG.maxTokens !== undefined ? { maxTokens: DEFAULT_LLM_CONFIG.maxTokens } : {}),
        ...(DEFAULT_LLM_CONFIG.temperature !== undefined ? { temperature: DEFAULT_LLM_CONFIG.temperature } : {}),
        disabled: false,
    };

    return {
        theme: 'default',
        llm: DEFAULT_LLM_CONFIG,
        providers: {
            openai: openaiProvider,
        },
        defaultAgent: 'general',
        agents: {},
        instructions: [],
        commands: {},
        permissions: {
            defaultMode: 'ask',
            tools: {},
        },
        disableAllHooks: false,
        vercel: {},
        sandbox: {
            mode: 'project',
            allowedPaths: [],
        },
        hooks: {},
        mcp: {
            servers: [],
        },
        lsp: {
            servers: [],
        },
        share: 'manual',
        autoupdate: true,
        debug: false,
        recentProjects: [],
        contextPaths: DEFAULT_CONTEXT_PATHS,
        shell: {
            path: shellPath,
            args: ['-l'],
        },
        plugins: {
            enabled: [],
            disabled: [],
            paths: [],
            allowIncompatible: false,
        },
    };
}

export function getProviderCredentialFilePaths(provider: string, credentialDir?: string): string[] {
    const baseDir = credentialDir ?? path.dirname(CONFIG_FILE);
    const primaryPath = path.join(baseDir, 'credentials', `${provider}.key`);
    const legacyPath = path.join(getXQoderPaths().dataDir, 'credentials', `${provider}.key`);
    return Array.from(new Set([primaryPath, legacyPath]));
}

export function loadProviderCredentialFromFile(provider: string, credentialDir?: string): string | undefined {
    const credentialFiles = getProviderCredentialFilePaths(provider, credentialDir);
    for (const credentialFile of credentialFiles) {
        try {
            if (!fs.existsSync(credentialFile)) {
                continue;
            }
            const key = fs.readFileSync(credentialFile, 'utf-8').trim();
            if (key.length > 0) {
                return key;
            }
        } catch {
            // try next credential location
        }
    }
    return undefined;
}
