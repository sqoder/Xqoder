// ============================================================
// xqoder config — 初始化、查看和诊断全局配置（Day 37：业务逻辑在 config-service）
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
    createConfigShowSnapshot,
    createConfigDoctorReport,
} from '../services/config-service.js';
import { DeployTarget } from '@xqoder/shared';

interface ConfigCommandDependencies extends ConfigServiceDependencies {}

// 兼容现有测试与外部引用
export { createConfigShowSnapshot, createConfigDoctorReport } from '../services/config-service.js';
export type { ConfigInitOptions, ConfigShowSnapshot, ConfigDoctorReport, ConfigDoctorCheck } from '../services/config-service.js';

export function createConfigCommand(
    manager: ConfigManager = configManager,
    dependencies: ConfigCommandDependencies = {},
): Command {
    const configCommand = new Command('config')
        .description('初始化、查看和诊断 XQoder 全局配置');

    configCommand
        .command('init')
        .description('初始化 ~/.xqoder/config.json')
        .option('-p, --provider <provider>', 'LLM 提供商', 'openai')
        .option('-m, --model <model>', '默认模型')
        .option('--api-key <key>', 'LLM API Key')
        .option('--base-url <url>', '自定义 API Base URL')
        .option('--default-agent <name>', '默认 agent 名称', 'general')
        .option('--small-model <model>', 'small model 名称')
        .option('--small-provider <provider>', 'small model 对应的 provider')
        .option('--instruction <text>', '全局 instruction，可重复传入', collectOption, [])
        .option('--default-deploy-target <target>', '默认部署目标', DeployTarget.Vercel)
        .option('--vercel-scope <scope>', '默认 Vercel 团队或个人 scope')
        .option('--sandbox-mode <mode>', 'Agent 权限模式 (project/paths/full-access)')
        .option('--allow-path <path>', '额外允许访问的路径，可重复传入', collectOption, [])
        .option('--debug', '启用调试模式')
        .action((options: ConfigInitOptions) => {
            runConfigInit(manager, options, dependencies);
        });

    configCommand
        .command('show')
        .description('显示当前生效配置（会应用环境变量覆盖，并自动脱敏）')
        .option('--json', '以 JSON 输出')
        .action((options: ConfigOutputOptions) => {
            runConfigShow(manager, options, dependencies);
        });

    configCommand
        .command('doctor')
        .description('检查配置、依赖和凭据是否可用')
        .option('--json', '以 JSON 输出')
        .action(async (options: ConfigOutputOptions) => {
            await runConfigDoctor(manager, options, dependencies);
        });

    configCommand
        .command('schema')
        .description('输出配置文件的 JSON Schema')
        .option('-o, --output <path>', '输出到文件（不指定则输出到 stdout）')
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
