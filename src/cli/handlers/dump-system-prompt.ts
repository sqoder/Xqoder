// P10 fast-path: --dump-system-prompt
//
// Loads the minimum config needed to resolve sandbox settings + runtime
// identity, calls `buildChatSystemPrompt`, writes the result to stdout.
// No Ink, no TUI, no commander.

import { buildChatSystemPrompt } from '../../application/chat/prompt-composer.js';
import { ConfigManager } from '../../infra/shared/config.js';
import type { SandboxSettings } from '../../infra/shared/types.js';
import { parseModelFlag } from '../provider-flag.js';

const FALLBACK_SANDBOX: SandboxSettings = { mode: 'project', allowedPaths: [] };

export async function run(args: string[]): Promise<void> {
    const configManager = new ConfigManager();
    const config = configManager.load();
    const sandbox = config.sandbox ?? FALLBACK_SANDBOX;

    const modelOverride = parseModelFlag(args) ?? undefined;
    const cwdIdx = args.indexOf('--cwd');
    const cwd = cwdIdx !== -1 && args[cwdIdx + 1] ? String(args[cwdIdx + 1]) : process.cwd();

    const prompt = buildChatSystemPrompt(sandbox, cwd, {
        structuredOutput: true,
        runtimeIdentity: modelOverride
            ? { provider: resolveProviderEnvFlag(), model: modelOverride }
            : undefined,
    });
    process.stdout.write(`${prompt}\n`);
}

function resolveProviderEnvFlag(): string {
    if (process.env.CLAUDE_CODE_USE_OPENAI === '1' || process.env.CLAUDE_CODE_USE_OPENAI === 'true') return 'openai';
    if (process.env.CLAUDE_CODE_USE_GEMINI === '1' || process.env.CLAUDE_CODE_USE_GEMINI === 'true') return 'gemini';
    if (process.env.CLAUDE_CODE_USE_MISTRAL === '1' || process.env.CLAUDE_CODE_USE_MISTRAL === 'true') return 'mistral';
    if (process.env.CLAUDE_CODE_USE_GITHUB === '1' || process.env.CLAUDE_CODE_USE_GITHUB === 'true') return 'github';
    if (process.env.CLAUDE_CODE_USE_BEDROCK === '1' || process.env.CLAUDE_CODE_USE_BEDROCK === 'true') return 'bedrock';
    if (process.env.CLAUDE_CODE_USE_VERTEX === '1' || process.env.CLAUDE_CODE_USE_VERTEX === 'true') return 'vertex';
    return 'anthropic';
}
