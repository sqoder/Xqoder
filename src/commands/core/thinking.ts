// P20b — `xqoder think|effort|fast` CLI commands.
//
// Persists the user's preference to `~/.xqoder/config.json` under the
// `thinking` key. Runtime code (agent.ts) reads this key and merges it with
// model defaults via resolveThinking before each turn.

import { Command } from 'commander';
import { ConfigManager, configManager } from '@xqoder/shared';
import {
    assertEffort,
    formatEffort,
    isFastModeCoolingDown,
    getFastCooldownRemainingMs,
    toggleFastMode,
} from '../../shared/thinking/index.js';

export interface ThinkingCommandDependencies {
    manager?: ConfigManager;
    writeOutput?: (output: string) => void;
}

function writer(dependencies: ThinkingCommandDependencies): (line: string) => void {
    return dependencies.writeOutput ?? ((line) => process.stdout.write(`${line}\n`));
}

function loadThinking(manager: ConfigManager): NonNullable<ReturnType<ConfigManager['load']>['thinking']> {
    const config = manager.load();
    return config.thinking ?? {};
}

function saveThinking(
    manager: ConfigManager,
    next: NonNullable<ReturnType<ConfigManager['load']>['thinking']>,
): void {
    const config = manager.load();
    manager.set({ ...config, thinking: next });
    manager.save();
}

export function runThinkSet(
    value: 'on' | 'off',
    dependencies: ThinkingCommandDependencies = {},
): { mode: 'enabled' | 'disabled' } {
    const manager = dependencies.manager ?? configManager;
    const current = loadThinking(manager);
    const mode = value === 'on' ? 'enabled' : 'disabled';
    saveThinking(manager, { ...current, mode });
    writer(dependencies)(`thinking: ${mode}`);
    return { mode };
}

export function runEffortSet(
    rawEffort: string,
    dependencies: ThinkingCommandDependencies = {},
): { effort: 'low' | 'medium' | 'high' | 'xhigh' } {
    const effort = assertEffort(rawEffort);
    const manager = dependencies.manager ?? configManager;
    const current = loadThinking(manager);
    saveThinking(manager, { ...current, effort });
    writer(dependencies)(`effort: ${formatEffort(effort)}`);
    return { effort };
}

export function runFastToggle(
    dependencies: ThinkingCommandDependencies = {},
): { fastMode: 'standard' | 'fast'; cooldownMs: number } {
    const manager = dependencies.manager ?? configManager;
    const current = loadThinking(manager);
    const fastMode = toggleFastMode(current.fastMode);
    saveThinking(manager, { ...current, fastMode });
    const write = writer(dependencies);
    const cooldownMs = getFastCooldownRemainingMs();
    if (fastMode === 'fast') {
        if (isFastModeCoolingDown()) {
            write(`fast mode: requested, but still cooling down (${Math.ceil(cooldownMs / 1000)}s remaining)`);
        } else {
            write('fast mode: on');
        }
    } else {
        write('fast mode: off');
    }
    return { fastMode, cooldownMs };
}

export function runThinkingStatus(
    dependencies: ThinkingCommandDependencies = {},
): { mode: string; effort: string; fastMode: string; cooldownRemainingMs: number } {
    const manager = dependencies.manager ?? configManager;
    const current = loadThinking(manager);
    const write = writer(dependencies);
    const cooldownRemainingMs = getFastCooldownRemainingMs();
    const output = {
        mode: current.mode ?? 'disabled',
        effort: formatEffort(current.effort),
        fastMode: current.fastMode ?? 'standard',
        cooldownRemainingMs,
    };
    write(`thinking: ${output.mode}`);
    write(`effort: ${output.effort}`);
    write(`fast_mode: ${output.fastMode}${cooldownRemainingMs > 0 ? ` (cooldown ${Math.ceil(cooldownRemainingMs / 1000)}s)` : ''}`);
    return output;
}

export function createThinkCommand(dependencies: ThinkingCommandDependencies = {}): Command {
    const cmd = new Command('think')
        .description('Enable or disable reasoning (Anthropic thinking / DeepSeek-R1 thinking).')
        .argument('[mode]', 'on | off (omit to show current)')
        .action((mode?: string) => {
            try {
                if (!mode) {
                    runThinkingStatus(dependencies);
                    return;
                }
                if (mode !== 'on' && mode !== 'off') {
                    throw new Error(`invalid mode: ${mode} — expected 'on' or 'off'`);
                }
                runThinkSet(mode, dependencies);
            } catch (error) {
                process.stderr.write(`think failed: ${error instanceof Error ? error.message : String(error)}\n`);
                process.exit(1);
            }
        });
    return cmd;
}

export function createEffortCommand(dependencies: ThinkingCommandDependencies = {}): Command {
    return new Command('effort')
        .description('Set reasoning effort level (low | medium | high | xhigh).')
        .argument('<level>', 'low | medium | high | xhigh (aliases: mid, max, extreme)')
        .action((level: string) => {
            try {
                runEffortSet(level, dependencies);
            } catch (error) {
                process.stderr.write(`effort failed: ${error instanceof Error ? error.message : String(error)}\n`);
                process.exit(1);
            }
        });
}

export function createFastCommand(dependencies: ThinkingCommandDependencies = {}): Command {
    return new Command('fast')
        .description('Toggle Anthropic fast-mode beta (honored when not cooling down).')
        .action(() => {
            try {
                runFastToggle(dependencies);
            } catch (error) {
                process.stderr.write(`fast failed: ${error instanceof Error ? error.message : String(error)}\n`);
                process.exit(1);
            }
        });
}

export const thinkCommand = createThinkCommand();
export const effortCommand = createEffortCommand();
export const fastCommand = createFastCommand();
