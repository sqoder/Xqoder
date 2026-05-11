import { Command } from 'commander';
import { logger } from '@xqoder/shared';
import { loadSkillRegistry } from '../../core/skills/index.js';

export interface SkillsCommandDependencies {
    cwd?: string;
    writeOutput?: (output: string) => void;
}

interface SkillsOutputOptions {
    json?: boolean;
}

export function createSkillsCommand(dependencies: SkillsCommandDependencies = {}): Command {
    const command = new Command('skills').description('List and inspect project / user skills');

    command
        .command('ls')
        .description('List available skills')
        .option('--json', 'Output in JSON format')
        .action((options: SkillsOutputOptions) => runSafely(() => runListSkillsCommand(options, dependencies)));

    command
        .command('info')
        .description('Show skill details (metadata + file path + body length)')
        .argument('<name>', 'skill name')
        .option('--json', 'Output in JSON format')
        .action((name: string, options: SkillsOutputOptions) => runSafely(() => runInfoSkillsCommand(name, options, dependencies)));

    return command;
}

export function runListSkillsCommand(
    options: SkillsOutputOptions = {},
    dependencies: SkillsCommandDependencies = {},
): Array<{ name: string; description: string; filePath: string }> {
    const cwd = dependencies.cwd ?? process.cwd();
    const registry = loadSkillRegistry(cwd);
    const entries = registry.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        filePath: skill.filePath,
    }));

    const write = dependencies.writeOutput ?? console.log;
    if (options.json) {
        write(JSON.stringify(entries, null, 2));
        return entries;
    }

    if (entries.length === 0) {
        write('No skills found under .xqoder/skills, .claude/skills, or user-level equivalents.');
        return entries;
    }

    for (const entry of entries) {
        write(`${entry.name} — ${entry.description}`);
    }
    return entries;
}

export function runInfoSkillsCommand(
    name: string,
    options: SkillsOutputOptions = {},
    dependencies: SkillsCommandDependencies = {},
): Record<string, unknown> {
    const cwd = dependencies.cwd ?? process.cwd();
    const registry = loadSkillRegistry(cwd);
    const skill = registry.get(name);
    if (!skill) {
        throw new Error(`Skill not found: ${name}`);
    }

    const payload = {
        name: skill.name,
        description: skill.description,
        triggers: skill.triggers,
        tools: skill.tools,
        filePath: skill.filePath,
        bodyLength: skill.body.length,
    };

    const write = dependencies.writeOutput ?? console.log;
    if (options.json) {
        write(JSON.stringify(payload, null, 2));
    } else {
        write(`name: ${payload.name}`);
        write(`description: ${payload.description}`);
        if (skill.triggers.length > 0) write(`triggers: ${skill.triggers.join(', ')}`);
        if (skill.tools.length > 0) write(`tools: ${skill.tools.join(', ')}`);
        write(`filePath: ${payload.filePath}`);
        write(`bodyLength: ${payload.bodyLength}`);
    }
    return payload;
}

function runSafely(action: () => void): void {
    try {
        action();
    } catch (err) {
        logger.error(`Skills command failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

export const skillsCommand = createSkillsCommand();
