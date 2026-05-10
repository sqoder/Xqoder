import { Command } from 'commander';
import {
    clearFeatureOverride,
    describeFeatures,
    writeFeatureOverride,
    FEATURE_DEFAULTS,
    type FeatureOrigin,
} from '../../shared/feature-flags.js';

export function createFeaturesCommand(): Command {
    const command = new Command('features')
        .description('Inspect and toggle XQoder runtime feature flags');

    command
        .command('ls')
        .description('List feature flags with current resolved values')
        .option('--json', 'Output as JSON')
        .action((options: { json?: boolean }) => {
            const origins = describeFeatures();
            if (options.json) {
                process.stdout.write(`${JSON.stringify(origins, null, 2)}\n`);
                return;
            }
            printFeatureTable(origins);
        });

    command
        .command('enable <name>')
        .description('Enable a feature flag (persists to ~/.xqoder/features.json)')
        .action((name: string) => {
            assertKnownFeatureOrWarn(name);
            const { featuresPath } = writeFeatureOverride(name, true);
            process.stdout.write(`enabled ${name} (written to ${featuresPath})\n`);
        });

    command
        .command('disable <name>')
        .description('Disable a feature flag (persists to ~/.xqoder/features.json)')
        .action((name: string) => {
            assertKnownFeatureOrWarn(name);
            const { featuresPath } = writeFeatureOverride(name, false);
            process.stdout.write(`disabled ${name} (written to ${featuresPath})\n`);
        });

    command
        .command('reset <name>')
        .description('Remove the override so the flag falls back to its default')
        .action((name: string) => {
            const { featuresPath } = clearFeatureOverride(name);
            process.stdout.write(`reset ${name} (written to ${featuresPath})\n`);
        });

    return command;
}

function assertKnownFeatureOrWarn(name: string): void {
    if (!Object.prototype.hasOwnProperty.call(FEATURE_DEFAULTS, name)) {
        process.stderr.write(
            `warning: "${name}" is not a built-in feature flag. ` +
            `Overriding anyway — it will only have effect if the code checks it.\n`,
        );
    }
}

function printFeatureTable(origins: FeatureOrigin[]): void {
    const nameWidth = Math.max(4, ...origins.map((origin) => origin.name.length));
    const header = `${'name'.padEnd(nameWidth)}  default  current  source`;
    process.stdout.write(`${header}\n`);
    process.stdout.write(`${'-'.repeat(header.length)}\n`);
    for (const origin of origins) {
        const line = [
            origin.name.padEnd(nameWidth),
            formatBool(origin.default).padEnd(7),
            formatBool(origin.enabled).padEnd(7),
            origin.source,
        ].join('  ');
        process.stdout.write(`${line}\n`);
    }
}

function formatBool(value: boolean): string {
    return value ? 'on' : 'off';
}

export const featuresCommand = createFeaturesCommand();
