import * as path from 'node:path';
import type { Command } from 'commander';
import type { OutputFormat } from '@xqoder/shared';
import { runNonInteractivePrompt, type ChatServiceDependencies } from '../application/chat/index.js';
import { createDefaultChatSessionStore } from '../infrastructure/storage/index.js';
import { runTuiInterface as runTuiCommand } from '../interfaces/tui/index.js';

export interface RootShellOptions {
    prompt?: string;
    print?: string;
    cwd?: string;
    outputFormat?: string;
    json?: boolean;
    quiet?: boolean;
    model?: string;
    agent?: string;
    resume?: string;
    continue?: boolean;
    forkSession?: boolean;
    permissionMode?: string;
    effort?: string;
    maxTurns?: number;
    noSessionPersistence?: boolean;
    allowedTools?: string;
    disallowedTools?: string;
}

export interface RootShellDependencies {
    promptRunner?: (options: {
        prompt: string;
        cwd: string;
        outputFormat: OutputFormat;
        quiet: boolean;
        model?: string;
        agent?: string;
        resume?: string;
        continue?: boolean;
        forkSession?: boolean;
        permissionMode?: string;
        effort?: string;
        maxTurns?: number;
        noSessionPersistence?: boolean;
        allowedTools?: string[];
        disallowedTools?: string[];
    }) => Promise<void>;
    chatDependencies?: ChatServiceDependencies;
}

export function applyRootShellOptions(program: Command): void {
    program
        .option('-p, --prompt <text>', 'Non-interactive mode: send a single prompt and output the result')
        .option('--print <text>', 'Alias for --prompt')
        .option('-c, --cwd <dir>', 'Specify working directory')
        .option('-f, --output-format <format>', 'Output format: text, json, or stream-json', 'text')
        .option('--json', 'Output results in JSON format')
        .option('-q, --quiet', 'Disable additional output in non-interactive mode')
        .option('-m, --model <model>', 'Specify LLM model')
        .option('-a, --agent <name>', 'Specify agent')
        .option('--resume <idOrName>', 'Resume a specific session')
        .option('--continue', 'Resume the most recent session')
        .option('--fork-session', 'Fork the session being resumed')
        .option('--permission-mode <mode>', 'Permission mode: auto, allow, ask, deny', 'ask')
        .option('--effort <level>', 'Specify effort level: low, medium, high, xhigh, max')
        .option('--max-turns <n>', 'Maximum number of turns in non-interactive mode', parseInt)
        .option('--no-session-persistence', 'Disable session persistence')
        .option('--allowedTools <tools>', 'Comma-separated list of allowed tools')
        .option('--disallowedTools <tools>', 'Comma-separated list of disallowed tools');
}

export function resolveRootShellOutputFormat(rawValue: unknown, jsonFlag: boolean): OutputFormat {
    if (jsonFlag) {
        return 'json';
    }

    const format = String(rawValue).toLowerCase();
    if (format === 'json' || format === 'stream-json') {
        return format as OutputFormat;
    }

    if (rawValue === undefined || format === 'text') {
        return 'text';
    }

    throw new Error(`invalid format option: ${String(rawValue)}\nValid formats: text, json, stream-json`);
}

export function canLaunchInteractiveTui(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY && typeof process.stdin.setRawMode === 'function');
}

export async function runRootShellAction(
    options: RootShellOptions,
    dependencies: RootShellDependencies = {},
): Promise<'handled' | 'show-help'> {
    const prompt = options.prompt || options.print;

    if (prompt) {
        const cwd = options.cwd ? path.resolve(String(options.cwd)) : process.cwd();
        const outputFormat = resolveRootShellOutputFormat(options.outputFormat, Boolean(options.json));

        const allowedTools = options.allowedTools ? options.allowedTools.split(',').map(t => t.trim()) : undefined;
        const disallowedTools = options.disallowedTools ? options.disallowedTools.split(',').map(t => t.trim()) : undefined;

        const promptRunner = dependencies.promptRunner ?? ((promptOptions) => runNonInteractivePrompt(promptOptions, {
            createSessionStore: createDefaultChatSessionStore,
            ...dependencies.chatDependencies,
        }));

        await promptRunner({
            prompt: String(prompt),
            cwd,
            outputFormat,
            quiet: Boolean(options.quiet),
            model: options.model,
            agent: options.agent,
            resume: options.resume,
            continue: options.continue,
            forkSession: options.forkSession,
            permissionMode: options.permissionMode,
            effort: options.effort,
            maxTurns: options.maxTurns,
            noSessionPersistence: options.noSessionPersistence,
            allowedTools,
            disallowedTools,
        });
        return 'handled';
    }

    if (canLaunchInteractiveTui()) {
        await runTuiCommand({
            dir: options.cwd,
            model: options.model,
            agent: options.agent,
            prompt: prompt,
            session: options.resume,
            continue: options.continue,
            fork: options.forkSession,
        });
        return 'handled';
    }

    return 'show-help';
}
