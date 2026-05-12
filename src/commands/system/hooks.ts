import { Command, Option } from 'commander';
import { ConfigManager, configManager, type HookHandlerConfig } from '@xqoder/shared';
import {
    runAddHookCommand,
    runHooksCommand,
    runHooksPathCommand,
    runRemoveHookCommand,
    runSetDisableAllHooksCommand,
    runShowHooksCommand,
    type HookMutationOptions,
    type HookMutationResult,
    type HookTestOptions,
    type HookTestResult,
    type HooksCommandDependencies,
    type HooksOutputOptions,
    type HooksSnapshot,
    type HooksToggleResult,
    type RemoveHookOptions,
} from '../../application/system/hooks.js';
import { runTestHookCommand } from '../../application/integrations/hooks-test.js';

export {
    runAddHookCommand,
    runHooksCommand,
    runHooksPathCommand,
    runRemoveHookCommand,
    runSetDisableAllHooksCommand,
    runShowHooksCommand,
    runTestHookCommand,
};
export type {
    HookMutationOptions,
    HookMutationResult,
    HookTestOptions,
    HookTestResult,
    HooksCommandDependencies,
    HooksOutputOptions,
    HooksSnapshot,
    HooksToggleResult,
    RemoveHookOptions,
};

interface AddCommandCliOptions extends HookMutationOptions {
    type?: 'command' | 'http' | 'prompt' | 'agent';
    command?: string;
    url?: string;
    prompt?: string;
    agent?: string;
    model?: string;
    shell?: string;
    async?: boolean;
    timeout?: string;
}

interface RemoveCommandCliOptions extends HooksOutputOptions {
    event: string;
    index: string;
}

interface TestCommandCliOptions extends HookTestOptions {
    toolName?: string;
    payloadJson?: string;
}

function parseTimeoutMs(raw: string | undefined): number | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`--timeout must be a non-negative number (ms), got "${raw}"`);
    }
    return parsed;
}

function buildHandlerFromCliOptions(options: AddCommandCliOptions): HookHandlerConfig {
    const timeout = parseTimeoutMs(options.timeout);
    const type = options.type ?? 'command';
    switch (type) {
        case 'command': {
            if (!options.command?.trim()) throw new Error('--command is required for type=command');
            return {
                type: 'command',
                command: options.command.trim(),
                async: options.async === true,
                ...(options.shell?.trim() ? { shell: options.shell.trim() } : {}),
                ...(timeout !== undefined ? { timeout } : {}),
            };
        }
        case 'http': {
            if (!options.url?.trim()) throw new Error('--url is required for type=http');
            return {
                type: 'http',
                url: options.url.trim(),
                ...(timeout !== undefined ? { timeout } : {}),
            };
        }
        case 'prompt': {
            if (!options.prompt?.trim()) throw new Error('--prompt is required for type=prompt');
            return {
                type: 'prompt',
                prompt: options.prompt.trim(),
                ...(options.model?.trim() ? { model: options.model.trim() } : {}),
                ...(timeout !== undefined ? { timeout } : {}),
            };
        }
        case 'agent': {
            if (!options.prompt?.trim()) throw new Error('--prompt is required for type=agent');
            return {
                type: 'agent',
                prompt: options.prompt.trim(),
                ...(options.agent?.trim() ? { agent: options.agent.trim() } : {}),
                ...(options.model?.trim() ? { model: options.model.trim() } : {}),
                ...(timeout !== undefined ? { timeout } : {}),
            };
        }
        default:
            throw new Error(`Unknown hook type "${type as string}"`);
    }
}

export function createHooksCommand(
    manager: ConfigManager = configManager,
    dependencies: HooksCommandDependencies = {},
): Command {
    const command = new Command('hooks')
        .description('Inspect and update lifecycle hook configurations')
        .action((options: HooksOutputOptions) => {
            runHooksCommand(() => runShowHooksCommand(options, dependencies, manager));
        });

    command
        .command('show')
        .description('Show effective hook configurations and sources')
        .option('--dir <dir>', 'Project directory')
        .option('--event <event>', 'Filter by event name')
        .option('--json', 'Output in JSON format')
        .action((options: HooksOutputOptions) => {
            runHooksCommand(() => runShowHooksCommand(options, dependencies, manager));
        });

    command
        .command('list')
        .description('Alias for `hooks show` — list configured hook handlers')
        .option('--dir <dir>', 'Project directory')
        .option('--event <event>', 'Filter by event name')
        .option('--json', 'Output in JSON format')
        .action((options: HooksOutputOptions) => {
            runHooksCommand(() => runShowHooksCommand(options, dependencies, manager));
        });

    command
        .command('path')
        .description('Print the config file path used when writing hook settings')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((options: HooksOutputOptions) => {
            runHooksCommand(() => runHooksPathCommand(options, dependencies));
        });

    command
        .command('enable')
        .description('Enable all hooks in one config scope')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((options: HooksOutputOptions) => {
            runHooksCommand(() => runSetDisableAllHooksCommand(false, options, dependencies, manager));
        });

    command
        .command('disable')
        .description('Disable all hooks in one config scope')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((options: HooksOutputOptions) => {
            runHooksCommand(() => runSetDisableAllHooksCommand(true, options, dependencies, manager));
        });

    command
        .command('add')
        .description('Append a hook handler for an event (writes to the configured scope)')
        .requiredOption('--event <event>', 'Hook event name (SessionStart, PreToolUse, ...)')
        .option('--matcher <matcher>', 'Tool matcher (PreToolUse/PostToolUse only)')
        .addOption(new Option('--type <type>', 'Handler type').choices(['command', 'http', 'prompt', 'agent']).default('command'))
        .option('--command <command>', 'Shell command for type=command')
        .option('--shell <shell>', 'Override shell (defaults to sh / cmd.exe)')
        .option('--async', 'Run command hook as fire-and-forget (non-PreToolUse only)', false)
        .option('--url <url>', 'HTTP endpoint for type=http')
        .option('--prompt <prompt>', 'Prompt text for type=prompt|agent')
        .option('--agent <agent>', 'Subagent name for type=agent')
        .option('--model <model>', 'Override model for type=prompt|agent')
        .option('--timeout <ms>', 'Handler timeout in ms (defaults to 5000)')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((options: AddCommandCliOptions) => {
            runHooksCommand(() => {
                const handler = buildHandlerFromCliOptions(options);
                runAddHookCommand(handler, options, dependencies, manager);
            });
        });

    command
        .command('remove')
        .description('Remove the Nth registered handler for an event (ordered across matcher groups)')
        .requiredOption('--event <event>', 'Hook event name')
        .requiredOption('--index <index>', 'Zero-based index into the flattened handler list')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((options: RemoveCommandCliOptions) => {
            runHooksCommand(() => {
                const index = Number(options.index);
                if (!Number.isInteger(index) || index < 0) {
                    throw new Error(`--index must be a non-negative integer, got "${options.index}"`);
                }
                const resolved: RemoveHookOptions = {
                    ...options,
                    index,
                };
                runRemoveHookCommand(resolved, dependencies, manager);
            });
        });

    command
        .command('test')
        .description('Dispatch configured hooks for an event against a synthetic payload')
        .requiredOption('--event <event>', 'Hook event name')
        .option('--tool-name <name>', 'Tool name for PreToolUse/PostToolUse (default: run_command)')
        .option('--payload <json>', 'JSON object merged into the synthetic payload')
        .option('--dir <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action(async (options: TestCommandCliOptions) => {
            try {
                const normalizedOptions: HookTestOptions = {
                    ...options,
                    ...(options.payloadJson ? { payloadJson: options.payloadJson } : {}),
                };
                await runTestHookCommand(normalizedOptions, dependencies, manager);
            } catch (error) {
                process.stderr.write(`hooks command failed: ${error instanceof Error ? error.message : String(error)}\n`);
                process.exit(1);
            }
        });

    return command;
}

export const hooksCommand = createHooksCommand();
