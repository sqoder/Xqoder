import { spawn } from 'node:child_process';
import type { HooksSettings, MessageAttachment } from '@xqoder/shared';

const DEFAULT_HOOK_TIMEOUT_MS = 5_000;

export interface UserPromptSubmitHookInput {
    text: string;
    attachments: MessageAttachment[];
    cwd: string;
    projectRoot: string;
    sessionId?: string;
    hooks: HooksSettings | undefined;
    disableAllHooks?: boolean;
}

export interface UserPromptSubmitHookResult {
    text: string;
    attachments: MessageAttachment[];
    blocked?: boolean;
    reason?: string;
    additionalContext?: string;
}

interface PromptHookPayload {
    hook_event_name: 'UserPromptSubmit';
    session_id?: string;
    cwd: string;
    project_root: string;
    prompt: string;
    attachment_count: number;
}

interface ParsedPromptHookOutput {
    continue?: boolean;
    stopReason?: string;
    decision?: string;
    reason?: string;
    rewritten?: string;
    systemMessage?: string;
    hookSpecificOutput?: {
        additionalContext?: string;
    };
}

export async function dispatchUserPromptSubmit(
    input: UserPromptSubmitHookInput,
): Promise<UserPromptSubmitHookResult> {
    const base: UserPromptSubmitHookResult = {
        text: input.text,
        attachments: input.attachments,
    };

    if (input.disableAllHooks) return base;
    const matcherGroups = input.hooks?.UserPromptSubmit ?? [];
    if (matcherGroups.length === 0) return base;

    const payload: PromptHookPayload = {
        hook_event_name: 'UserPromptSubmit',
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        cwd: input.cwd,
        project_root: input.projectRoot,
        prompt: input.text,
        attachment_count: input.attachments.length,
    };

    let currentText = input.text;
    let additionalContext: string | undefined;

    for (const group of matcherGroups) {
        for (const handler of group.hooks) {
            if (handler.type !== 'command') continue;
            const timeoutMs = handler.timeout ?? DEFAULT_HOOK_TIMEOUT_MS;
            const hookPayload: PromptHookPayload = { ...payload, prompt: currentText };
            let output: string;
            try {
                output = await runCommandHook(handler.command, handler.shell, hookPayload, input, timeoutMs);
            } catch {
                continue;
            }
            const parsed = parseOutput(output);
            if (!parsed) continue;

            if (parsed.decision === 'deny' || parsed.decision === 'block' || parsed.continue === false) {
                return {
                    text: currentText,
                    attachments: input.attachments,
                    blocked: true,
                    ...(parsed.reason?.trim()
                        ? { reason: parsed.reason.trim() }
                        : parsed.stopReason?.trim()
                            ? { reason: parsed.stopReason.trim() }
                            : {}),
                };
            }
            if (typeof parsed.rewritten === 'string' && parsed.rewritten.length > 0) {
                currentText = parsed.rewritten;
            }
            if (parsed.hookSpecificOutput?.additionalContext?.trim()) {
                additionalContext = (additionalContext ?? '') + (additionalContext ? '\n' : '') + parsed.hookSpecificOutput.additionalContext.trim();
            }
        }
    }

    return {
        text: currentText,
        attachments: input.attachments,
        ...(additionalContext ? { additionalContext } : {}),
    };
}

function parseOutput(raw: string): ParsedPromptHookOutput | undefined {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
        return parsed as ParsedPromptHookOutput;
    } catch {
        return undefined;
    }
}

async function runCommandHook(
    command: string,
    shellOverride: string | undefined,
    payload: PromptHookPayload,
    input: UserPromptSubmitHookInput,
    timeoutMs: number,
): Promise<string> {
    const shellPath = shellOverride?.trim() || process.env['SHELL'] || (process.platform === 'win32' ? 'cmd.exe' : 'sh');
    const shellArgs = shellPath.endsWith('cmd.exe') ? ['/d', '/s', '/c', command] : ['-c', command];

    return new Promise<string>((resolve, reject) => {
        const child = spawn(shellPath, shellArgs, {
            cwd: input.cwd,
            env: {
                ...process.env,
                CLAUDE_PROJECT_DIR: input.projectRoot,
                XQODER_PROJECT_DIR: input.projectRoot,
                XQODER_CWD: input.cwd,
                XQODER_HOOK_EVENT_NAME: 'UserPromptSubmit',
                ...(input.sessionId ? { XQODER_SESSION_ID: input.sessionId } : {}),
            } as NodeJS.ProcessEnv,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            try { child.kill('SIGTERM'); } catch { /* ignore */ }
            reject(new Error('UserPromptSubmit hook timed out'));
        }, timeoutMs);

        child.stdout?.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
        child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code && code !== 0 && stdout.trim().length === 0) {
                reject(new Error(stderr.trim() || `Hook exited with status ${code}`));
                return;
            }
            resolve(stdout.trim());
        });
        child.stdin?.end(JSON.stringify(payload));
    });
}
