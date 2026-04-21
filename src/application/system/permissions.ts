import {
    ConfigManager,
    configManager,
    type AgentPermissionMode,
    type PermissionSettings,
    type SandboxMode,
} from '@xqoder/shared';
import {
    createLayeredConfigSnapshot,
    describeConfigSourceKind,
    resolveConfigWriteTarget,
    type ConfigWriteScope,
} from './config-targets.js';

export interface PermissionsOutputOptions {
    cwd?: string;
    dir?: string;
    json?: boolean;
    scope?: ConfigWriteScope;
}

export interface PermissionsCommandDependencies {
    writeOutput?: (output: string) => void;
}

export interface PermissionRuleView {
    source: string;
    sourcePath: string;
    kind: 'default' | 'tool';
    mode: AgentPermissionMode;
    tool?: string;
}

export interface PermissionsSnapshot {
    cwd: string;
    permissions: Required<PermissionSettings>;
    sandboxMode: SandboxMode;
    sources: Array<{
        kind: string;
        path: string;
        defaultMode?: AgentPermissionMode;
        tools: Record<string, AgentPermissionMode>;
        sandboxMode?: SandboxMode;
    }>;
    rules: PermissionRuleView[];
}

export interface PermissionWriteResult {
    scope: ConfigWriteScope;
    configPath: string;
    permissions: Required<PermissionSettings>;
}

const VALID_PERMISSION_MODES: AgentPermissionMode[] = ['allow', 'ask', 'deny'];

export function createPermissionsSnapshot(
    options: PermissionsOutputOptions = {},
    manager: Pick<ConfigManager, 'load' | 'getLoadMetadata'> = configManager,
): PermissionsSnapshot {
    const snapshot = createLayeredConfigSnapshot(resolvePermissionsSnapshotOptions(options), manager);
    const sources = snapshot.sources.map((source) => ({
        kind: describeConfigSourceKind(source.kind),
        path: source.path,
        ...(source.permissions?.defaultMode !== undefined ? { defaultMode: source.permissions.defaultMode } : {}),
        tools: { ...(source.permissions?.tools ?? {}) },
        ...(source.sandbox?.mode !== undefined ? { sandboxMode: source.sandbox.mode } : {}),
    }));

    return {
        cwd: snapshot.cwd,
        permissions: {
            defaultMode: snapshot.config.permissions?.defaultMode ?? 'ask',
            tools: { ...(snapshot.config.permissions?.tools ?? {}) },
            allowedTools: [...(snapshot.config.permissions?.allowedTools ?? [])],
            disallowedTools: [...(snapshot.config.permissions?.disallowedTools ?? [])],
        },
        sandboxMode: snapshot.config.sandbox?.mode ?? 'project',
        sources,
        rules: buildPermissionRules(sources),
    };
}

export function runShowPermissionsCommand(
    options: PermissionsOutputOptions = {},
    dependencies: PermissionsCommandDependencies = {},
    manager: Pick<ConfigManager, 'load' | 'getLoadMetadata'> = configManager,
): PermissionsSnapshot {
    const snapshot = createPermissionsSnapshot(options, manager);
    if (options.json) {
        writeOutput(JSON.stringify(snapshot, null, 2), dependencies);
        return snapshot;
    }

    const lines = [
        `cwd=${snapshot.cwd}`,
        `sandboxMode=${snapshot.sandboxMode}`,
        `effectiveDefaultMode=${snapshot.permissions.defaultMode}`,
        `effectiveTools=${formatTools(snapshot.permissions.tools)}`,
    ];

    if (snapshot.rules.length > 0) {
        lines.push('rules:');
        for (const rule of snapshot.rules) {
            lines.push(
                rule.kind === 'default'
                    ? `- ${rule.source} default=${rule.mode} sourcePath=${rule.sourcePath}`
                    : `- ${rule.source} tool=${rule.tool} mode=${rule.mode} sourcePath=${rule.sourcePath}`,
            );
        }
    } else {
        lines.push('rules=-');
    }

    if (snapshot.sources.length > 0) {
        lines.push('sources:');
        for (const source of snapshot.sources) {
            lines.push(`- ${source.kind} ${source.path} default=${source.defaultMode ?? '-'} tools=${formatTools(source.tools)} sandbox=${source.sandboxMode ?? '-'}`);
        }
    }

    writeOutput(lines.join('\n'), dependencies);
    return snapshot;
}

export function runPermissionsPathCommand(
    options: PermissionsOutputOptions = {},
    dependencies: PermissionsCommandDependencies = {},
): string {
    const target = resolveConfigWriteTarget(resolvePermissionsWriteTargetOptions(options));
    if (options.json) {
        writeOutput(JSON.stringify({ scope: target.scope, path: target.path }, null, 2), dependencies);
    } else {
        writeOutput(target.path, dependencies);
    }
    return target.path;
}

export function runSetPermissionsDefaultCommand(
    mode: string,
    options: PermissionsOutputOptions = {},
    dependencies: PermissionsCommandDependencies = {},
    manager?: Pick<ConfigManager, 'load' | 'set' | 'save' | 'getLoadMetadata' | 'getConfigPath'>,
): PermissionWriteResult {
    const parsedMode = parsePermissionMode(mode);
    const target = resolvePermissionsWriteTarget(options, manager);
    const current = target.manager.load({ mode: 'single' });
    target.manager.set({
        ...current,
        permissions: {
            defaultMode: parsedMode,
            tools: { ...(current.permissions?.tools ?? {}) },
        },
    });
    target.manager.save();
    return writePermissionWriteResult(target.scope, target.manager, dependencies, options);
}

export function runSetToolPermissionCommand(
    tool: string,
    mode: string,
    options: PermissionsOutputOptions = {},
    dependencies: PermissionsCommandDependencies = {},
    manager?: Pick<ConfigManager, 'load' | 'set' | 'save' | 'getLoadMetadata' | 'getConfigPath'>,
): PermissionWriteResult {
    const normalizedTool = tool.trim();
    if (!normalizedTool) {
        throw new Error('Tool name cannot be empty');
    }

    const parsedMode = parsePermissionMode(mode);
    const target = resolvePermissionsWriteTarget(options, manager);
    const current = target.manager.load({ mode: 'single' });
    target.manager.set({
        ...current,
        permissions: {
            defaultMode: current.permissions?.defaultMode ?? 'ask',
            tools: {
                ...(current.permissions?.tools ?? {}),
                [normalizedTool]: parsedMode,
            },
        },
    });
    target.manager.save();
    return writePermissionWriteResult(target.scope, target.manager, dependencies, options);
}

export function runUnsetToolPermissionCommand(
    tool: string,
    options: PermissionsOutputOptions = {},
    dependencies: PermissionsCommandDependencies = {},
    manager?: Pick<ConfigManager, 'load' | 'set' | 'save' | 'getLoadMetadata' | 'getConfigPath'>,
): PermissionWriteResult {
    const normalizedTool = tool.trim();
    if (!normalizedTool) {
        throw new Error('Tool name cannot be empty');
    }

    const target = resolvePermissionsWriteTarget(options, manager);
    const current = target.manager.load({ mode: 'single' });
    const nextTools = { ...(current.permissions?.tools ?? {}) };
    delete nextTools[normalizedTool];
    target.manager.set({
        ...current,
        permissions: {
            defaultMode: current.permissions?.defaultMode ?? 'ask',
            tools: nextTools,
        },
    });
    target.manager.save();
    return writePermissionWriteResult(target.scope, target.manager, dependencies, options);
}

export function runPermissionsCommand(fn: () => void): void {
    try {
        fn();
    } catch (error) {
        process.stderr.write(`permissions command failed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}

function buildPermissionRules(
    sources: PermissionsSnapshot['sources'],
): PermissionRuleView[] {
    const rules: PermissionRuleView[] = [];

    for (const source of sources) {
        if (source.defaultMode) {
            rules.push({
                source: source.kind,
                sourcePath: source.path,
                kind: 'default',
                mode: source.defaultMode,
            });
        }

        for (const [tool, mode] of Object.entries(source.tools).sort(([left], [right]) => left.localeCompare(right))) {
            rules.push({
                source: source.kind,
                sourcePath: source.path,
                kind: 'tool',
                tool,
                mode,
            });
        }
    }

    return rules;
}

function resolvePermissionsWriteTarget(
    options: PermissionsOutputOptions,
    manager?: Pick<ConfigManager, 'load' | 'set' | 'save' | 'getLoadMetadata' | 'getConfigPath'>,
): {
    scope: ConfigWriteScope;
    manager: Pick<ConfigManager, 'load' | 'set' | 'save' | 'getLoadMetadata' | 'getConfigPath'>;
} {
    if (manager) {
        return {
            scope: options.scope ?? 'project',
            manager,
        };
    }

    const target = resolveConfigWriteTarget(resolvePermissionsWriteTargetOptions(options));
    return {
        scope: target.scope,
        manager: target.manager,
    };
}

function writePermissionWriteResult(
    scope: ConfigWriteScope,
    manager: Pick<ConfigManager, 'load' | 'getLoadMetadata' | 'getConfigPath'>,
    dependencies: PermissionsCommandDependencies,
    options: PermissionsOutputOptions,
): PermissionWriteResult {
    const snapshot = createPermissionsSnapshot(resolvePermissionsSnapshotOptions(options), manager);
    const result: PermissionWriteResult = {
        scope,
        configPath: manager.getConfigPath(),
        permissions: snapshot.permissions,
    };

    if (options.json) {
        writeOutput(JSON.stringify(result, null, 2), dependencies);
    } else {
        writeOutput(`scope=${scope} configPath=${result.configPath} defaultMode=${result.permissions.defaultMode} tools=${formatTools(result.permissions.tools)}`, dependencies);
    }

    return result;
}

function formatTools(tools: Record<string, AgentPermissionMode>): string {
    const entries = Object.entries(tools).sort(([left], [right]) => left.localeCompare(right));
    return entries.length > 0
        ? entries.map(([tool, mode]) => `${tool}:${mode}`).join(',')
        : '-';
}

function resolvePermissionsCwd(options: PermissionsOutputOptions): string | undefined {
    return normalizeOptionalToken(options.dir) ?? normalizeOptionalToken(options.cwd);
}

function resolvePermissionsSnapshotOptions(options: PermissionsOutputOptions): PermissionsOutputOptions {
    const cwd = resolvePermissionsCwd(options);
    return cwd ? { cwd } : {};
}

function resolvePermissionsWriteTargetOptions(options: PermissionsOutputOptions): { cwd?: string; scope?: ConfigWriteScope } {
    const cwd = resolvePermissionsCwd(options);
    return {
        ...(cwd ? { cwd } : {}),
        ...(options.scope ? { scope: options.scope } : {}),
    };
}

function parsePermissionMode(value: string): AgentPermissionMode {
    const normalized = value.trim().toLowerCase();
    if ((VALID_PERMISSION_MODES as string[]).includes(normalized)) {
        return normalized as AgentPermissionMode;
    }
    throw new Error(`Unsupported permission mode: ${value}`);
}

function normalizeOptionalToken(value: string | undefined): string | undefined {
    return value?.trim() || undefined;
}

function writeOutput(output: string, dependencies: PermissionsCommandDependencies): void {
    (dependencies.writeOutput ?? console.log)(output);
}
