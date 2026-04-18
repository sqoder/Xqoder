import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import {
    ConfigManager,
    configManager,
    getXQoderPaths,
    getDefaultModelForProvider,
    isLLMProviderName,
    logger,
    resolveConfigWithEnvOverrides,
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
    persistPlain?: boolean;
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
    manager: Pick<ConfigManager, 'load'> & { getConfigPath?: () => string } = configManager,
): AuthProviderSummary[] {
    const loaded = manager.load({ mode: 'single' });
    const { config } = resolveConfigWithEnvOverrides(loaded, process.env, {
        credentialDir: resolveCredentialDir(manager),
    });
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

/** Persist apiKey in config; currently stored as plain text. Use environment variables for production/CI. */
export function runAuthLoginCommand(
    provider: string,
    options: AuthLoginOptions,
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> & { getConfigPath?: () => string } = configManager,
): void {
    const parsedProvider = parseProviderOrThrow(provider);
    const current = manager.load({ mode: 'single' });
    const shouldPersistPlain = options.persistPlain === true;
    const storedApiKey = shouldPersistPlain
        ? options.apiKey
        : persistProviderCredential(parsedProvider, options.apiKey, manager);

    manager.update({
        providers: {
            ...(current.providers ?? {}),
            [parsedProvider]: {
                ...(current.providers?.[parsedProvider] ?? {}),
                apiKey: storedApiKey,
                ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
                ...(options.defaultModel !== undefined ? { defaultModel: options.defaultModel } : {}),
                disabled: false,
            },
        },
    });
    manager.save();

    if (shouldPersistPlain) {
        logger.warn(`Logged in to provider: ${parsedProvider} (API Key stored as plain text)`);
    } else {
        logger.success(`Logged in to provider: ${parsedProvider} (Credentials saved to local secure file)`);
    }
}

export function runAuthLogoutCommand(
    provider: string,
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> & { getConfigPath?: () => string } = configManager,
): void {
    const parsedProvider = parseProviderOrThrow(provider);
    const current = manager.load({ mode: 'single' });

    if (!current.providers?.[parsedProvider]) {
        throw new Error(`Provider configuration not found: ${parsedProvider}`);
    }

    removeProviderCredential(parsedProvider, manager);

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

    logger.success(`Logged out from provider: ${parsedProvider}`);
}

export function createAuthCommand(
    manager: ConfigManager = configManager,
    dependencies: AuthCommandDependencies = {},
): Command {
    const authCommand = new Command('auth')
        .description('Manage provider credentials');

    authCommand
        .command('login')
        .description('Write API credentials for a provider')
        .argument('<provider>', 'provider name')
        .requiredOption('--api-key <key>', 'API Key')
        .option('--persist-plain', 'Write API Key as plain text in configuration (not recommended)', false)
        .option('--base-url <url>', 'Custom Base URL')
        .option('--default-model <model>', 'Update default model for this provider')
        .action((provider: string, options: AuthLoginOptions) => {
            try {
                runAuthLoginCommand(provider, options, manager);
            } catch (error) {
                logger.error(`auth login failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    authCommand
        .command('logout')
        .description('Clear API Key for a provider')
        .argument('<provider>', 'provider name')
        .action((provider: string) => {
            try {
                runAuthLogoutCommand(provider, manager);
            } catch (error) {
                logger.error(`auth logout failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    authCommand
        .command('list')
        .alias('ls')
        .description('View status of currently stored provider credentials')
        .option('--json', 'Output in JSON format')
        .option('--all', 'Show all built-in providers')
        .action((options: AuthListOptions) => {
            try {
                runListAuthCommand(options, dependencies, manager);
            } catch (error) {
                logger.error(`auth list failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    return authCommand;
}

export const authCommand = createAuthCommand();

function parseProviderOrThrow(value: string): LLMProviderName {
    if (!isLLMProviderName(value)) {
        throw new Error(`Unsupported provider: ${value}`);
    }

    return value;
}

function writeOutput(output: string, dependencies: AuthCommandDependencies): void {
    (dependencies.writeOutput ?? console.log)(output);
}

function persistProviderCredential(
    provider: LLMProviderName,
    apiKey: string,
    manager: { getConfigPath?: () => string },
): string {
    const credentialFile = getProviderCredentialFilePath(provider, manager);
    const dir = path.dirname(credentialFile);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(credentialFile, apiKey, 'utf-8');
    try {
        fs.chmodSync(credentialFile, 0o600);
    } catch {
        // ignore chmod errors on unsupported environments
    }
    return '';
}

function removeProviderCredential(provider: LLMProviderName, manager: { getConfigPath?: () => string }): void {
    const credentialFile = getProviderCredentialFilePath(provider, manager);
    if (!fs.existsSync(credentialFile)) {
        return;
    }
    try {
        fs.unlinkSync(credentialFile);
    } catch {
        // ignore credential cleanup errors
    }
}

function getProviderCredentialFilePath(provider: LLMProviderName, manager: { getConfigPath?: () => string }): string {
    const configuredPath = manager.getConfigPath?.();
    if (configuredPath) {
        return path.join(path.dirname(configuredPath), 'credentials', `${provider}.key`);
    }
    const paths = getXQoderPaths();
    return path.join(path.dirname(paths.configFile), 'credentials', `${provider}.key`);
}

function resolveCredentialDir(manager: { getConfigPath?: () => string }): string | undefined {
    const configuredPath = manager.getConfigPath?.();
    return configuredPath ? path.dirname(configuredPath) : undefined;
}
