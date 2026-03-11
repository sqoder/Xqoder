// ============================================================
// xqoder deploy — 一键部署
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
    logger.info('🚀 XQoder Deploy — 项目部署');
    logger.info(`📁 目录: ${options.dir}`);
    logger.info(`☁️  目标: ${DeployTarget.Vercel}`);

    const resolvedDir = path.resolve(options.dir);
    const loadedConfig = dependencies.configManager?.load({ cwd: resolvedDir }) ?? configManager.load({ cwd: resolvedDir });
    const { config } = resolveConfigWithEnvOverrides(loadedConfig);
    const resolvedScope = options.scope ?? config.vercel?.scope;

    const configGen = dependencies.configGenerator ?? new DefaultDeployConfigGenerator();
    const deployConfig = {
        ...configGen.generate(resolvedDir, DeployTarget.Vercel),
        scope: resolvedScope,
    };

    logger.info(`📦 构建命令: ${deployConfig.buildCommand ?? '无'}`);
    logger.info(`📂 输出目录: ${deployConfig.outputDir ?? '无'}`);
    if (resolvedScope) {
        logger.info(`🏷️  Scope: ${resolvedScope}`);
    }

    const deployer = dependencies.deployerFactory?.({ token: options.token, scope: resolvedScope })
        ?? new VercelDeployer({ token: options.token, scope: resolvedScope });

    logger.info('🏗️  开始部署...');
    const result = await deployer.deploy(deployConfig);

    if (result.status !== DeployStatus.Ready) {
        throw new Error(result.error ?? '部署失败');
    }

    logger.success('🎉 部署成功!');
    if (result.url) {
        logger.success(`🌐 URL: ${result.url}`);
    }
}

export function createDeployCommand(dependencies: DeployCommandDependencies = {}): Command {
    return new Command('deploy')
        .description('一键部署项目到 Vercel')
        .option('-d, --dir <dir>', '项目目录', '.')
        .option('--token <token>', 'Vercel Token')
        .option('--scope <scope>', 'Vercel 团队或个人 scope')
        .action(async (options: DeployCommandOptions) => {
            try {
                await runDeployCommand(options, dependencies);
            } catch (err) {
                logger.error(`部署失败: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });
}

export const deployCommand = createDeployCommand();
