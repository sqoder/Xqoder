// ============================================================
// Custom Commands — .md 文件加载和 $VAR 参数替换
// 参考 OpenCode: internal/tui/components/dialog/custom_commands.go
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface CustomCommand {
    name: string;
    scope: 'user' | 'project';
    content: string;
    filePath: string;
    /** Extracted $VARIABLE names */
    variables: string[];
}

export interface CustomCommandReference {
    id: string;
    label: string;
}

const VAR_PATTERN = /\$([A-Z_][A-Z0-9_]*)/g;

function extractVariables(content: string): string[] {
    const vars = new Set<string>();
    let match;
    while ((match = VAR_PATTERN.exec(content)) !== null) {
        vars.add(match[1]!);
    }
    return Array.from(vars);
}

function substituteVariables(content: string, values: Record<string, string>): string {
    return content.replace(VAR_PATTERN, (_, varName: string) => {
        return values[varName] ?? `$${varName}`;
    });
}

function loadCommandsFromDir(dir: string, scope: 'user' | 'project'): CustomCommand[] {
    const commands: CustomCommand[] = [];
    if (!fs.existsSync(dir)) return commands;

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
            const filePath = path.join(dir, entry.name);
            const content = fs.readFileSync(filePath, 'utf-8');
            const name = entry.name.replace(/\.md$/, '');
            commands.push({
                name,
                scope,
                content,
                filePath,
                variables: extractVariables(content),
            });
        }
    } catch { /* ignore */ }

    return commands;
}

function loadCustomCommandSources(projectDir?: string): CustomCommand[] {
    const commands: CustomCommand[] = [];

    // User-level commands: ~/.config/xqoder/commands/ or ~/.xqoder/commands/
    const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
    commands.push(...loadCommandsFromDir(path.join(xdgConfig, 'xqoder', 'commands'), 'user'));
    commands.push(...loadCommandsFromDir(path.join(os.homedir(), '.xqoder', 'commands'), 'user'));

    // Project-level commands: <project>/.xqoder/commands/
    if (projectDir) {
        commands.push(...loadCommandsFromDir(path.join(projectDir, '.xqoder', 'commands'), 'project'));
    }

    return commands;
}

/**
 * Load all custom commands from user and project directories.
 */
export function loadCustomCommands(projectDir?: string): CustomCommand[] {
    const commands = loadCustomCommandSources(projectDir);

    // De-duplicate by name (project takes precedence)
    const seen = new Map<string, CustomCommand>();
    for (const cmd of commands) {
        const existing = seen.get(cmd.name);
        if (!existing || cmd.scope === 'project') {
            seen.set(cmd.name, cmd);
        }
    }

    return Array.from(seen.values());
}

/**
 * Resolve command by reference:
 * - "foo" -> merged command (project overrides user)
 * - "user:foo" -> user-scoped command
 * - "project:foo" -> project-scoped command
 */
export function resolveCustomCommand(commandRef: string, projectDir?: string): CustomCommand | null {
    const trimmed = commandRef.trim();
    if (!trimmed) {
        return null;
    }

    const scopedMatch = trimmed.match(/^(user|project):(.+)$/);
    if (scopedMatch) {
        const scope = scopedMatch[1] as 'user' | 'project';
        const name = scopedMatch[2]!.trim();
        if (!name) {
            return null;
        }
        const sources = loadCustomCommandSources(projectDir);
        return sources.find((command) => command.scope === scope && command.name === name) ?? null;
    }

    return loadCustomCommands(projectDir).find((command) => command.name === trimmed) ?? null;
}

/**
 * Returns command references for command palette / slash completion.
 * Includes merged names and scoped aliases (user:/project:).
 */
export function listCustomCommandReferences(projectDir?: string): CustomCommandReference[] {
    const refs: CustomCommandReference[] = [];
    const merged = loadCustomCommands(projectDir);
    for (const command of merged) {
        refs.push({
            id: command.name,
            label: command.name,
        });
    }

    const seen = new Set(refs.map((ref) => ref.id));
    const sources = loadCustomCommandSources(projectDir);
    for (const source of sources) {
        const id = `${source.scope}:${source.name}`;
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        refs.push({
            id,
            label: id,
        });
    }

    return refs;
}

/**
 * Execute a custom command by replacing variables and returning the final prompt text.
 */
export function executeCustomCommand(command: CustomCommand, variables: Record<string, string>): string {
    return substituteVariables(command.content, variables);
}
