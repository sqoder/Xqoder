import { Command } from 'commander';
import {
    ConfigManager,
    configManager,
    getDefaultModelForProvider,
    isLLMProviderName,
    logger,
    resolveAgentLLMConfig,
    SUPPORTED_LLM_PROVIDERS,
    type LLMProviderName,
} from '@xqoder/shared';

interface AuthListOptions {
    json?: boolean;
    all?: boolean;
}

interface AuthLoginOptions {
    apiKey: string;
    baseUrl?: string;
    defaultModel?: string;
}

interface AuthCommandDependencies {
    writeOutput?: (output: string) => void;
}

interface AuthProviderSummary {
    provider: LLMProviderName;
    authenticated: boolean;
    current: boolean;
    disabled: boolean;
    defaultModel: string;
    baseUrl?: string;
}

export function runListAuthCommand(
    options: AuthListOptions,
    dependencies: AuthCommandDependencies = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): AuthProviderSummary[] {
    const config = manager.load({ mode: 'single' });
    const currentProvider = resolveAgentLLMConfig(config).provider;
    const providerNames = options.all
        ? SUPPORTED_LLM_PROVIDERS
        : Array.from(new Set([
            currentProvider,
            ...Object.keys(config.providers ?? {}) as LLMProviderName[],
        ])).sort((left, right) => left.localeCompare(right));

    const summaries = providerNames.map((provider) => {
        const settings = config.providers?.[provider];
        return {
            provider,
            authenticated: Boolean(settings?.apiKey?.trim()),
            current: currentProvider === provider,
            disabled: settings?.disabled === true,
            defaultModel: settings?.defaultModel?.trim() || getDefaultModelForProvider(provider),
            baseUrl: settings?.baseUrl?.trim() || undefined,
        } satisfies AuthProviderSummary;
    });

    if (options.json) {
        writeOutput(JSON.stringify(summaries, null, 2), dependencies);
    } else {
        for (const summary of summaries) {
            writeOutput([
                summary.provider,
                `current=${summary.current ? 'yes' : 'no'}`,
                `authenticated=${summary.authenticated ? 'yes' : 'no'}`,
                `disabled=${summary.disabled ? 'yes' : 'no'}`,
                `defaultModel=${summary.defaultModel}`,
                `baseUrl=${summary.baseUrl ?? '-'}`,
            ].join(' '), dependencies);
        }
    }

    return summaries;
}

/** 将 apiKey 写入 config 并持久化；当前为明文存储，生产/CI 建议用环境变量代替。 */
export function runAuthLoginCommand(
    provider: string,
    options: AuthLoginOptions,
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    const parsedProvider = parseProviderOrThrow(provider);
    const current = manager.load({ mode: 'single' });

    manager.update({
        providers: {
            ...(current.providers ?? {}),
            [parsedProvider]: {
                ...(current.providers?.[parsedProvider] ?? {}),
                apiKey: options.apiKey,
                ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
                ...(options.defaultModel !== undefined ? { defaultModel: options.defaultModel } : {}),
                disabled: false,
            },
        },
    });
    manager.save();

    logger.success(`已登录 provider: ${parsedProvider}`);
}

export function runAuthLogoutCommand(
    provider: string,
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    const parsedProvider = parseProviderOrThrow(provider);
    const current = manager.load({ mode: 'single' });

    if (!current.providers?.[parsedProvider]) {
        throw new Error(`未找到 provider 配置: ${parsedProvider}`);
    }

    manager.update({
        providers: {
            ...(current.providers ?? {}),
            [parsedProvider]: {
                ...(current.providers?.[parsedProvider] ?? {}),
                apiKey: '',
            },
        },
    });
    manager.save();

    logger.success(`已登出 provider: ${parsedProvider}`);
}

export function createAuthCommand(
    manager: ConfigManager = configManager,
    dependencies: AuthCommandDependencies = {},
): Command {
    const authCommand = new Command('auth')
        .description('管理 provider 凭据');

    authCommand
        .command('login')
        .description('写入一个 provider 的 API 凭据')
        .argument('<provider>', 'provider 名称')
        .requiredOption('--api-key <key>', 'API Key')
        .option('--base-url <url>', '自定义 Base URL')
        .option('--default-model <model>', '同时更新 provider 默认模型')
        .action((provider: string, options: AuthLoginOptions) => {
            try {
                runAuthLoginCommand(provider, options, manager);
            } catch (error) {
                logger.error(`auth login 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    authCommand
        .command('logout')
        .description('清除一个 provider 的 API Key')
        .argument('<provider>', 'provider 名称')
        .action((provider: string) => {
            try {
                runAuthLogoutCommand(provider, manager);
            } catch (error) {
                logger.error(`auth logout 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    authCommand
        .command('list')
        .alias('ls')
        .description('查看当前存储的 provider 凭据状态')
        .option('--json', '以 JSON 输出')
        .option('--all', '显示所有内建 provider')
        .action((options: AuthListOptions) => {
            try {
                runListAuthCommand(options, dependencies, manager);
            } catch (error) {
                logger.error(`auth list 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    return authCommand;
}

export const authCommand = createAuthCommand();

function parseProviderOrThrow(value: string): LLMProviderName {
    if (!isLLMProviderName(value)) {
        throw new Error(`不支持的 provider: ${value}`);
    }

    return value;
}

function writeOutput(output: string, dependencies: AuthCommandDependencies): void {
    (dependencies.writeOutput ?? console.log)(output);
}
