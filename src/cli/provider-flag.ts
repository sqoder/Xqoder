// P10: clean-room port of openclaude's --provider / --model flag application.
//
// Maps the user-facing provider name to the CLAUDE_CODE_USE_* env vars the rest
// of the codebase already reads. Runs before any heavy CLI import so the
// startup banner / model resolution pick up the switch.

export function parseProviderFlag(args: string[]): string | null {
    const idx = args.indexOf('--provider');
    if (idx === -1) {
        return null;
    }
    const value = args[idx + 1];
    if (!value || value.startsWith('--')) {
        return null;
    }
    return value;
}

export function parseModelFlag(args: string[]): string | null {
    const idx = args.indexOf('--model');
    if (idx === -1) {
        return null;
    }
    const value = args[idx + 1];
    if (!value || value.startsWith('--')) {
        return null;
    }
    return value;
}

export const VALID_PROVIDERS = [
    'anthropic',
    'openai',
    'openai-compatible',
    'azure',
    'openrouter',
    'xai',
    'groq',
    'dashscope',
    'ollama',
    'github',
    'gemini',
    'mistral',
    'bedrock',
    'vertex',
    'local',
] as const;

export type ProviderFlagName = (typeof VALID_PROVIDERS)[number];

function clearProviderFlags(): void {
    delete process.env.CLAUDE_CODE_USE_OPENAI;
    delete process.env.CLAUDE_CODE_USE_GEMINI;
    delete process.env.CLAUDE_CODE_USE_MISTRAL;
    delete process.env.CLAUDE_CODE_USE_GITHUB;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
}

export function applyProviderFlag(provider: string, args: string[]): { error?: string } {
    if (!(VALID_PROVIDERS as readonly string[]).includes(provider)) {
        return {
            error: `Unknown provider "${provider}". Valid providers: ${VALID_PROVIDERS.join(', ')}`,
        };
    }
    clearProviderFlags();
    const model = parseModelFlag(args);

    switch (provider) {
        case 'anthropic':
            if (model) process.env.ANTHROPIC_MODEL = model;
            break;
        case 'openai':
        case 'openai-compatible':
        case 'azure':
        case 'openrouter':
        case 'xai':
        case 'groq':
        case 'dashscope':
        case 'local':
            process.env.CLAUDE_CODE_USE_OPENAI = '1';
            if (model) process.env.OPENAI_MODEL = model;
            break;
        case 'ollama':
            process.env.CLAUDE_CODE_USE_OPENAI = '1';
            process.env.OPENAI_BASE_URL ??= 'http://localhost:11434/v1';
            process.env.OPENAI_API_KEY ??= 'ollama';
            if (model) process.env.OPENAI_MODEL = model;
            break;
        case 'github':
            process.env.CLAUDE_CODE_USE_GITHUB = '1';
            if (model) process.env.OPENAI_MODEL = model;
            break;
        case 'gemini':
            process.env.CLAUDE_CODE_USE_GEMINI = '1';
            if (model) process.env.GEMINI_MODEL = model;
            break;
        case 'mistral':
            process.env.CLAUDE_CODE_USE_MISTRAL = '1';
            if (model) process.env.MISTRAL_MODEL = model;
            break;
        case 'bedrock':
            process.env.CLAUDE_CODE_USE_BEDROCK = '1';
            break;
        case 'vertex':
            process.env.CLAUDE_CODE_USE_VERTEX = '1';
            break;
    }
    return {};
}

export function applyProviderFlagFromArgs(args: string[]): { error?: string } | undefined {
    const provider = parseProviderFlag(args);
    if (!provider) {
        return undefined;
    }
    return applyProviderFlag(provider, args);
}

export function applyModelFlagFromArgs(args: string[]): void {
    if (args.includes('--provider')) {
        return;
    }
    const model = parseModelFlag(args);
    if (!model) {
        return;
    }
    const useGemini = process.env.CLAUDE_CODE_USE_GEMINI === '1' || process.env.CLAUDE_CODE_USE_GEMINI === 'true';
    const useMistral = process.env.CLAUDE_CODE_USE_MISTRAL === '1' || process.env.CLAUDE_CODE_USE_MISTRAL === 'true';
    const useOpenAI = process.env.CLAUDE_CODE_USE_OPENAI === '1' || process.env.CLAUDE_CODE_USE_OPENAI === 'true';
    const useGithub = process.env.CLAUDE_CODE_USE_GITHUB === '1' || process.env.CLAUDE_CODE_USE_GITHUB === 'true';

    if (useGemini) {
        process.env.GEMINI_MODEL = model;
    } else if (useMistral) {
        process.env.MISTRAL_MODEL = model;
    } else if (useOpenAI || useGithub) {
        process.env.OPENAI_MODEL = model;
    } else {
        process.env.ANTHROPIC_MODEL = model;
    }
}
