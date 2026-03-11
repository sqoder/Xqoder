import * as path from 'node:path';
import type { Command } from 'commander';
import type { OutputFormat } from '@xqoder/shared';
import { runNonInteractivePrompt } from './services/chat-service.js';
import { runTuiCommand } from './commands/tui.js';

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
        .option('-p, --prompt <text>', '非交互模式：发送单个 prompt 并输出结果')
        .option('-c, --cwd <dir>', '指定工作目录')
        .option('-f, --output-format <format>', '输出格式: text 或 json', 'text')
        .option('--json', '以 JSON 格式输出结果')
        .option('-q, --quiet', '关闭非交互模式中的附加输出')
        .option('-m, --model <model>', '指定 LLM 模型')
        .option('-a, --agent <name>', '指定 agent');
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
        await (dependencies.promptRunner ?? runNonInteractivePrompt)({
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
