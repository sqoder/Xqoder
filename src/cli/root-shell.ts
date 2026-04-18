import * as path from 'node:path';
import type { Command } from 'commander';
import type { OutputFormat } from '@xqoder/shared';
import { runNonInteractivePrompt } from '../application/chat/index.js';
import { createDefaultChatSessionStore } from '../infrastructure/storage/index.js';
import { runTuiInterface as runTuiCommand } from '../interfaces/tui/index.js';

export interface RootShellOptions {
    prompt?: string;
    cwd?: string;
    outputFormat?: string;
    json?: boolean;
    quiet?: boolean;
    model?: string;
    agent?: string;
}

export interface RootShellDependencies {
    promptRunner?: (options: {
        prompt: string;
        cwd: string;
        outputFormat: OutputFormat;
        quiet: boolean;
        model?: string;
        agent?: string;
    }) => Promise<void>;
}

export function applyRootShellOptions(program: Command): void {
    program
        .option('-p, --prompt <text>', 'Non-interactive mode: send a single prompt and output the result')
        .option('-c, --cwd <dir>', 'Specify working directory')
        .option('-f, --output-format <format>', 'Output format: text or json', 'text')
        .option('--json', 'Output results in JSON format')
        .option('-q, --quiet', 'Disable additional output in non-interactive mode')
        .option('-m, --model <model>', 'Specify LLM model')
        .option('-a, --agent <name>', 'Specify agent');
}

export function resolveRootShellOutputFormat(rawValue: unknown, jsonFlag: boolean): OutputFormat {
    if (jsonFlag) {
        return 'json';
    }

    if (rawValue === 'json') {
        return 'json';
    }

    if (rawValue === undefined || rawValue === 'text') {
        return 'text';
    }

    throw new Error(`invalid format option: ${String(rawValue)}\nValid formats: text, json`);
}

export function canLaunchInteractiveTui(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY && typeof process.stdin.setRawMode === 'function');
}

export async function runRootShellAction(
    options: RootShellOptions,
    dependencies: RootShellDependencies = {},
): Promise<'handled' | 'show-help'> {
    if (options.prompt) {
        const cwd = options.cwd ? path.resolve(String(options.cwd)) : process.cwd();
        const outputFormat = resolveRootShellOutputFormat(options.outputFormat, Boolean(options.json));
        const promptRunner = dependencies.promptRunner ?? ((promptOptions) => runNonInteractivePrompt(promptOptions, {
            createSessionStore: createDefaultChatSessionStore,
        }));
        await promptRunner({
            prompt: String(options.prompt),
            cwd,
            outputFormat,
            quiet: Boolean(options.quiet),
            model: options.model,
            agent: options.agent,
        });
        return 'handled';
    }

    if (canLaunchInteractiveTui()) {
        await runTuiCommand({
            dir: options.cwd,
            model: options.model,
            agent: options.agent,
            prompt: options.prompt,
        });
        return 'handled';
    }

    return 'show-help';
}
