// ============================================================
// xqoder deploy — One-click deployment
// ============================================================

import { Command } from 'commander';
import * as path from 'node:path';
import { ConfigManager, DeployStatus, DeployTarget, configManager, logger, resolveConfigWithEnvOverrides } from '@xqoder/shared';
import { type DeployConfigGenerator, type IDeployer, VercelDeployer, DeployConfigGenerator as DefaultDeployConfigGenerator } from '@xqoder/deploy';

interface DeployCommandOptions {
    dir: string;
    token?: string;
    scope?: string;
}

interface DeployCommandDependencies {
    configManager?: Pick<ConfigManager, 'load'>;
    configGenerator?: Pick<DeployConfigGenerator, 'generate'>;
    deployerFactory?: (options: { token?: string; scope?: string }) => IDeployer;
}

export async function runDeployCommand(
    options: DeployCommandOptions,
    dependencies: DeployCommandDependencies = {},
): Promise<void> {
    logger.info('🚀 XQoder Deploy — Project Deployment');
    logger.info(`📁 Directory: ${options.dir}`);
    logger.info(`☁️  Target: ${DeployTarget.Vercel}`);

    const resolvedDir = path.resolve(options.dir);
    const loadedConfig = dependencies.configManager?.load({ cwd: resolvedDir }) ?? configManager.load({ cwd: resolvedDir });
    const { config } = resolveConfigWithEnvOverrides(loadedConfig);
    const resolvedScope = options.scope ?? config.vercel?.scope;

    const configGen = dependencies.configGenerator ?? new DefaultDeployConfigGenerator();
    const deployConfig = {
        ...configGen.generate(resolvedDir, DeployTarget.Vercel),
        scope: resolvedScope,
    };

    logger.info(`📦 Build Command: ${deployConfig.buildCommand ?? 'None'}`);
    logger.info(`📂 Output Directory: ${deployConfig.outputDir ?? 'None'}`);
    if (resolvedScope) {
        logger.info(`🏷️  Scope: ${resolvedScope}`);
    }

    const deployer = dependencies.deployerFactory?.({ token: options.token, scope: resolvedScope })
        ?? new VercelDeployer({ token: options.token, scope: resolvedScope });

    logger.info('🏗️  Starting deployment...');
    const result = await deployer.deploy(deployConfig);

    if (result.status !== DeployStatus.Ready) {
        throw new Error(result.error ?? 'Deployment failed');
    }

    logger.success('🎉 Deployment successful!');
    if (result.url) {
        logger.success(`🌐 URL: ${result.url}`);
    }
}

export function createDeployCommand(dependencies: DeployCommandDependencies = {}): Command {
    return new Command('deploy')
        .description('One-click deployment to Vercel')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('--token <token>', 'Vercel Token')
        .option('--scope <scope>', 'Vercel team or personal scope')
        .action(async (options: DeployCommandOptions) => {
            try {
                await runDeployCommand(options, dependencies);
            } catch (err) {
                logger.error(`Deployment failed: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });
}

export const deployCommand = createDeployCommand();
