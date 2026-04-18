// ============================================================
// xqoder config — Initialize, view and diagnose global configuration (Day 37: Logic resides in config-service)
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import {
    ConfigManager,
    configManager,
    logger,
    generateConfigSchemaJson,
} from '@xqoder/shared';
import {
    runConfigInit,
    runConfigShow,
    runConfigDoctor,
    type ConfigInitOptions,
    type ConfigOutputOptions,
    type ConfigServiceDependencies,
} from '../../application/config/service.js';
import { DeployTarget } from '@xqoder/shared';

interface ConfigCommandDependencies extends ConfigServiceDependencies {}

// Backward compatibility for existing tests and external references
export { createConfigShowSnapshot, createConfigDoctorReport } from '../../application/config/service.js';
export type { ConfigInitOptions, ConfigShowSnapshot, ConfigDoctorReport, ConfigDoctorCheck } from '../../application/config/service.js';

export function createConfigCommand(
    manager: ConfigManager = configManager,
    dependencies: ConfigCommandDependencies = {},
): Command {
    const configCommand = new Command('config')
        .description('Initialize, view and diagnose XQoder global configuration');

    configCommand
        .command('init')
        .description('Initialize ~/.xqoder/config.json')
        .option('-p, --provider <provider>', 'LLM provider', 'openai')
        .option('-m, --model <model>', 'Default model')
        .option('--api-key <key>', 'LLM API Key')
        .option('--base-url <url>', 'Custom API Base URL')
        .option('--default-agent <name>', 'Default agent name', 'general')
        .option('--small-model <model>', 'Small model name')
        .option('--small-provider <provider>', 'Provider for the small model')
        .option('--instruction <text>', 'Global instruction, can be passed multiple times', collectOption, [])
        .option('--default-deploy-target <target>', 'Default deployment target', DeployTarget.Vercel)
        .option('--vercel-scope <scope>', 'Default Vercel team or personal scope')
        .option('--sandbox-mode <mode>', 'Agent permission mode (project/paths/full-access)')
        .option('--allow-path <path>', 'Extra allowed path, can be passed multiple times', collectOption, [])
        .option('--debug', 'Enable debug mode')
        .action((options: ConfigInitOptions) => {
            runConfigInit(manager, options, dependencies);
        });

    configCommand
        .command('show')
        .description('Show currently effective configuration (with environment overrides applied and sensitive data masked)')
        .option('--json', 'Output in JSON format')
        .action((options: ConfigOutputOptions) => {
            runConfigShow(manager, options, dependencies);
        });

    configCommand
        .command('doctor')
        .description('Check if configuration, dependencies and credentials are available')
        .option('--json', 'Output in JSON format')
        .action(async (options: ConfigOutputOptions) => {
            await runConfigDoctor(manager, options, dependencies);
        });

    configCommand
        .command('schema')
        .description('Output the JSON Schema for the configuration file')
        .option('-o, --output <path>', 'Output to file (defaults to stdout if not specified)')
        .action((options: { output?: string }) => {
            const schema = generateConfigSchemaJson(2);
            if (options.output) {
                const outPath = path.resolve(options.output);
                const outDir = path.dirname(outPath);
                if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
                fs.writeFileSync(outPath, schema, 'utf-8');
                logger.success(`Schema written to ${outPath}`);
            } else {
                (dependencies.writeOutput ?? console.log)(schema);
            }
        });

    return configCommand;
}

export const configCommand = createConfigCommand();

function collectOption(value: string, previous: string[]): string[] {
    return [...previous, value];
}
