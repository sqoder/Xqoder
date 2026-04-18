import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    ConfigManager,
    configManager,
    getXQoderPaths,
    resolveConfigWithEnvOverrides,
    type AgentPermissionMode,
    type ConfigLoadMetadata,
    type ConfigSourceInfo,
    type HookEventName,
    type HookHandlerConfig,
    type HookMatcherConfig,
    type HooksSettings,
    type PermissionSettings,
    type SandboxSettings,
    type XQoderConfig,
    isHookEventName,
} from '@xqoder/shared';

export type ConfigWriteScope = 'global' | 'project';

export interface ConfigWriteTarget {
    scope: ConfigWriteScope;
    path: string;
    manager: ConfigManager;
}

export interface SourceConfigFragment {
    kind: ConfigSourceInfo['kind'];
    path: string;
    permissions?: PermissionSettings;
    sandbox?: SandboxSettings;
    hooks?: HooksSettings;
    disableAllHooks?: boolean;
}

export interface LayeredConfigSnapshot {
    cwd: string;
    config: XQoderConfig;
    sources: SourceConfigFragment[];
}

export function createLayeredConfigSnapshot(
    options: {
        cwd?: string;
        env?: NodeJS.ProcessEnv;
    } = {},
    manager: Pick<ConfigManager, 'load' | 'getLoadMetadata'> = configManager,
): LayeredConfigSnapshot {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const loaded = manager.load({
        cwd,
        ...(options.env ? { env: options.env } : {}),
    });
    const { config } = resolveConfigWithEnvOverrides(loaded, options.env);
    const sources = readSourceFragments(manager.getLoadMetadata());

    return {
        cwd,
        config,
        sources,
    };
}

export function resolveConfigWriteTarget(
    options: {
        cwd?: string;
        scope?: ConfigWriteScope;
    } = {},
): ConfigWriteTarget {
    const scope = options.scope ?? 'project';
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const targetPath = scope === 'global'
        ? getXQoderPaths().configFile
        : resolveProjectWritePath(cwd);

    return {
        scope,
        path: targetPath,
        manager: new ConfigManager({
            configPath: targetPath,
            cwd,
        }),
    };
}

export function describeConfigSourceKind(kind: ConfigSourceInfo['kind']): string {
    switch (kind) {
        case 'global':
            return 'Global';
        case 'project':
            return 'Project';
        case 'xdg':
            return 'XDG';
        case 'explicit':
            return 'Explicit';
        case 'single':
            return 'Single';
    }
}

function readSourceFragments(metadata: ConfigLoadMetadata): SourceConfigFragment[] {
    return metadata.sources
        .filter((source) => source.exists)
        .map((source) => ({
            kind: source.kind,
            path: source.path,
            ...readSourceFragmentBody(source.path),
        }));
}

function readSourceFragmentBody(filePath: string): Omit<SourceConfigFragment, 'kind' | 'path'> {
    const raw = readJsonObject(filePath);
    const permissions = normalizePermissionFragment(raw['permissions']);
    const sandbox = normalizeSandboxFragment(raw['sandbox']);
    const hooks = normalizeHooksFragment(raw['hooks']);
    const disableAllHooks = typeof raw['disableAllHooks'] === 'boolean'
        ? raw['disableAllHooks']
        : undefined;

    return {
        ...(permissions ? { permissions } : {}),
        ...(sandbox ? { sandbox } : {}),
        ...(hooks ? { hooks } : {}),
        ...(disableAllHooks !== undefined ? { disableAllHooks } : {}),
    };
}

function readJsonObject(filePath: string): Record<string, unknown> {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function normalizePermissionFragment(value: unknown): PermissionSettings | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as Record<string, unknown>;
    const defaultMode = record['defaultMode'];
    const toolsValue = record['tools'];
    const toolEntries: Array<[string, AgentPermissionMode]> = Object.entries(
        toolsValue !== null && typeof toolsValue === 'object' ? toolsValue as Record<string, unknown> : {},
    ).flatMap(([toolName, mode]) => {
        const normalizedTool = toolName.trim();
        return normalizedTool.length > 0 && (mode === 'allow' || mode === 'ask' || mode === 'deny')
            ? [[normalizedTool, mode]]
            : [];
    });
    const tools = Object.fromEntries(toolEntries);

    if (defaultMode !== 'allow' && defaultMode !== 'ask' && defaultMode !== 'deny' && Object.keys(tools).length === 0) {
        return undefined;
    }

    return {
        ...(defaultMode === 'allow' || defaultMode === 'ask' || defaultMode === 'deny' ? { defaultMode } : {}),
        ...(Object.keys(tools).length > 0 ? { tools } : {}),
    };
}

function normalizeSandboxFragment(value: unknown): SandboxSettings | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as Record<string, unknown>;
    const mode = record['mode'];
    const allowedPaths = Array.isArray(record['allowedPaths'])
        ? record['allowedPaths'].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];

    if (mode !== 'project' && mode !== 'paths' && mode !== 'full-access' && allowedPaths.length === 0) {
        return undefined;
    }

    return {
        mode: mode === 'project' || mode === 'paths' || mode === 'full-access' ? mode : 'project',
        allowedPaths,
    };
}

function normalizeHooksFragment(value: unknown): HooksSettings | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const entries: Array<[HookEventName, HookMatcherConfig[]]> = [];
    for (const [eventName, matcherGroups] of Object.entries(value as Record<string, unknown>)) {
        const normalizedEventName = eventName.trim();
        const normalizedMatcherGroups = normalizeHookMatcherFragments(matcherGroups);
        if (isHookEventName(normalizedEventName) && normalizedMatcherGroups.length > 0) {
            entries.push([normalizedEventName, normalizedMatcherGroups]);
        }
    }

    const result = Object.fromEntries(entries);

    return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeHookMatcherFragments(value: unknown): HookMatcherConfig[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const normalized: HookMatcherConfig[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }

        const record = entry as Record<string, unknown>;
        const hooks = normalizeHookHandlerFragments(record['hooks']);
        if (hooks.length === 0) {
            continue;
        }

        const matcher = typeof record['matcher'] === 'string' && record['matcher'].trim().length > 0
            ? record['matcher'].trim()
            : undefined;
        normalized.push({
            hooks,
            ...(matcher !== undefined ? { matcher } : {}),
        });
    }

    return normalized;
}

function normalizeHookHandlerFragments(value: unknown): HookHandlerConfig[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => normalizeHookHandlerFragment(entry))
        .filter((entry): entry is HookHandlerConfig => entry !== null);
}

function normalizeHookHandlerFragment(value: unknown): HookHandlerConfig | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const record = value as Record<string, unknown>;
    const timeout = typeof record['timeout'] === 'number' && Number.isFinite(record['timeout'])
        ? record['timeout']
        : undefined;

    switch (record['type']) {
        case 'command':
            return typeof record['command'] === 'string' && record['command'].trim().length > 0
                ? {
                    type: 'command',
                    command: record['command'].trim(),
                    async: record['async'] === true,
                    ...(typeof record['shell'] === 'string' && record['shell'].trim().length > 0
                        ? { shell: record['shell'].trim() }
                        : {}),
                    ...(timeout !== undefined ? { timeout } : {}),
                }
                : null;
        case 'http':
            if (typeof record['url'] !== 'string' || record['url'].trim().length === 0) {
                return null;
            }
            return {
                type: 'http',
                url: record['url'].trim(),
                headers: Object.fromEntries(
                    Object.entries(record['headers'] !== null && typeof record['headers'] === 'object'
                        ? record['headers'] as Record<string, unknown>
                        : {})
                        .flatMap(([name, headerValue]) => {
                            const normalizedName = name.trim();
                            return normalizedName.length > 0 && typeof headerValue === 'string' && headerValue.trim().length > 0
                                ? [[normalizedName, headerValue]]
                                : [];
                        }),
                ),
                ...(timeout !== undefined ? { timeout } : {}),
            };
        case 'prompt':
            return typeof record['prompt'] === 'string' && record['prompt'].trim().length > 0
                ? {
                    type: 'prompt',
                    prompt: record['prompt'].trim(),
                    ...(typeof record['model'] === 'string' && record['model'].trim().length > 0
                        ? { model: record['model'].trim() }
                        : {}),
                    ...(timeout !== undefined ? { timeout } : {}),
                }
                : null;
        case 'agent':
            return typeof record['prompt'] === 'string' && record['prompt'].trim().length > 0
                ? {
                    type: 'agent',
                    prompt: record['prompt'].trim(),
                    ...(typeof record['agent'] === 'string' && record['agent'].trim().length > 0
                        ? { agent: record['agent'].trim() }
                        : {}),
                    ...(typeof record['model'] === 'string' && record['model'].trim().length > 0
                        ? { model: record['model'].trim() }
                        : {}),
                    ...(timeout !== undefined ? { timeout } : {}),
                }
                : null;
        default:
            return null;
    }
}

function resolveProjectWritePath(cwd: string): string {
    let current = cwd;
    const globalPaths = new Set([
        getXQoderPaths().configFile,
        path.join(getXQoderPaths().homeDir, '.xqoder.json'),
    ]);

    while (true) {
        const nestedPath = path.join(current, '.xqoder', 'config.json');
        if (fs.existsSync(nestedPath) && !globalPaths.has(nestedPath)) {
            return nestedPath;
        }

        const flatPath = path.join(current, '.xqoder.json');
        if (fs.existsSync(flatPath) && !globalPaths.has(flatPath)) {
            return flatPath;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return path.join(cwd, '.xqoder', 'config.json');
        }
        current = parent;
    }
}
