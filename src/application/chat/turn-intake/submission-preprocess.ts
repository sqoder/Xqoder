import { configManager, formatOutput, type ConfigManager, type OutputFormat } from '@xqoder/shared';
import { dispatchUserPromptSubmit } from './prompt-hook-bridge.js';

export interface ApplyUserPromptSubmitHookOptions {
    prompt: string;
    cwd: string;
    sessionId?: string | undefined;
    configManagerOverride?: Pick<ConfigManager, 'load'> | undefined;
}

export interface ApplyUserPromptSubmitHookResult {
    prompt: string;
    blocked?: boolean;
    reason?: string;
}

export type PromptSubmissionOutcome =
    | { status: 'proceed'; prompt: string }
    | { status: 'blocked'; response: string; sessionId: string };

/**
 * Runs the UserPromptSubmit hook (if configured) before the turn enters the main loop.
 * On deny/block, returns blocked=true so entry points can short-circuit with a synthetic reply.
 * On rewrite, returns the new prompt text to use for turn-input construction.
 */
export async function applyUserPromptSubmitHook(
    options: ApplyUserPromptSubmitHookOptions,
): Promise<ApplyUserPromptSubmitHookResult> {
    const loader = options.configManagerOverride ?? configManager;
    const loaded = safeLoad(loader, options.cwd);
    const hooks = loaded?.hooks;
    if (!hooks || !hooks.UserPromptSubmit || hooks.UserPromptSubmit.length === 0) {
        return { prompt: options.prompt };
    }
    const result = await dispatchUserPromptSubmit({
        text: options.prompt,
        attachments: [],
        cwd: options.cwd,
        projectRoot: options.cwd,
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        hooks,
    });
    if (result.blocked) {
        return {
            prompt: options.prompt,
            blocked: true,
            ...(result.reason ? { reason: result.reason } : {}),
        };
    }
    return { prompt: result.text };
}

/**
 * Thin wrapper around applyUserPromptSubmitHook that produces a uniform outcome
 * for the three run-chat entry points (CLI, headless, stream).
 */
export async function resolvePromptSubmissionOutcome(options: {
    prompt: string;
    cwd: string;
    sessionId?: string | undefined;
    configManagerOverride?: Pick<ConfigManager, 'load'> | undefined;
}): Promise<PromptSubmissionOutcome> {
    const preprocessed = await applyUserPromptSubmitHook(options);
    if (preprocessed.blocked) {
        return {
            status: 'blocked',
            response: preprocessed.reason ?? 'Prompt rejected by UserPromptSubmit hook.',
            sessionId: options.sessionId ?? `blocked:${Date.now()}`,
        };
    }
    return { status: 'proceed', prompt: preprocessed.prompt };
}

function safeLoad(loader: Pick<ConfigManager, 'load'>, cwd: string): ReturnType<ConfigManager['load']> | undefined {
    try {
        return loader.load({ cwd });
    } catch {
        return undefined;
    }
}

export function writeBlockedPromptResponse(response: string, outputFormat: OutputFormat): void {
    if (outputFormat === 'json') {
        process.stdout.write(formatOutput(response, { format: 'json' }));
    } else {
        process.stdout.write(response);
    }
    process.stdout.write('\n');
}
