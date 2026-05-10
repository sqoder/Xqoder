import {
    ConfigManager,
    configManager,
    type HookEventName,
    type HookHandlerConfig,
    type HookHandlerType,
    type HookMatcherConfig,
    type HooksSettings,
    SUPPORTED_HOOK_EVENTS,
    isHookEventName,
} from '@xqoder/shared';
import {
    createLayeredConfigSnapshot,
    describeConfigSourceKind,
    resolveConfigWriteTarget,
    type ConfigWriteScope,
    type SourceConfigFragment,
} from './config-targets.js';

export interface HooksOutputOptions {
    cwd?: string;
    dir?: string;
    json?: boolean;
    event?: string;
    scope?: ConfigWriteScope;
}

export interface HooksCommandDependencies {
    writeOutput?: (output: string) => void;
}

export interface HookEventSummary {
    event: HookEventName;
    matcherCount: number;
    handlerCount: number;
    types: HookHandlerType[];
}

export interface HookHandlerEntry {
    event: HookEventName;
    matcher?: string;
    type: HookHandlerType;
    source: string;
    sourcePath: string;
    command?: string;
    url?: string;
    prompt?: string;
    agent?: string;
    model?: string;
    async?: boolean;
    timeout?: number;
}

export interface HooksSnapshot {
    cwd: string;
    disableAllHooks: boolean;
    events: HookEventSummary[];
    entries: HookHandlerEntry[];
    sources: Array<{
        kind: string;
        path: string;
        disableAllHooks?: boolean;
        eventCount: number;
        handlerCount: number;
    }>;
}

export interface HooksToggleResult {
    scope: ConfigWriteScope;
    configPath: string;
    disableAllHooks: boolean;
}

export function createHooksSnapshot(
    options: HooksOutputOptions = {},
    manager: Pick<ConfigManager, 'load' | 'getLoadMetadata'> = configManager,
): HooksSnapshot {
    const snapshot = createLayeredConfigSnapshot(resolveHooksSnapshotOptions(options), manager);
    const eventFilter = resolveHookEventFilter(options.event);
    const effectiveHooks = filterHooksByEvent(snapshot.config.hooks ?? {}, eventFilter);
    const entries = buildHookEntries(snapshot.sources, eventFilter);
    const events = buildHookEventSummaries(effectiveHooks);
    const sources = snapshot.sources.map((source) => {
        const sourceHooks = filterHooksByEvent(source.hooks ?? {}, eventFilter);
        return {
            kind: describeConfigSourceKind(source.kind),
            path: source.path,
            ...(source.disableAllHooks !== undefined ? { disableAllHooks: source.disableAllHooks } : {}),
            eventCount: Object.keys(sourceHooks).length,
            handlerCount: countHandlers(sourceHooks),
        };
    });

    return {
        cwd: snapshot.cwd,
        disableAllHooks: snapshot.config.disableAllHooks ?? false,
        events,
        entries,
        sources,
    };
}

export function runShowHooksCommand(
    options: HooksOutputOptions = {},
    dependencies: HooksCommandDependencies = {},
    manager: Pick<ConfigManager, 'load' | 'getLoadMetadata'> = configManager,
): HooksSnapshot {
    const snapshot = createHooksSnapshot(options, manager);
    if (options.json) {
        writeOutput(JSON.stringify(snapshot, null, 2), dependencies);
        return snapshot;
    }

    const lines = [
        `cwd=${snapshot.cwd}`,
        `disableAllHooks=${snapshot.disableAllHooks ? 'yes' : 'no'}`,
        `events=${snapshot.events.length}`,
        `handlers=${snapshot.entries.length}`,
    ];

    if (snapshot.events.length === 0) {
        lines.push('hooks=-');
    } else {
        lines.push('events:');
        for (const event of snapshot.events) {
            lines.push(`- ${event.event} matchers=${event.matcherCount} handlers=${event.handlerCount} types=${event.types.join(',')}`);
        }
    }

    if (snapshot.sources.length > 0) {
        lines.push('sources:');
        for (const source of snapshot.sources) {
            lines.push(`- ${source.kind} ${source.path} disableAllHooks=${source.disableAllHooks === undefined ? '-' : source.disableAllHooks ? 'yes' : 'no'} events=${source.eventCount} handlers=${source.handlerCount}`);
        }
    }

    if (snapshot.entries.length > 0) {
        lines.push('details:');
        for (const entry of snapshot.entries) {
            lines.push(formatHookEntry(entry));
        }
    }

    writeOutput(lines.join('\n'), dependencies);
    return snapshot;
}

export function runHooksPathCommand(
    options: HooksOutputOptions = {},
    dependencies: HooksCommandDependencies = {},
): string {
    const target = resolveConfigWriteTarget(resolveHooksWriteTargetOptions(options));
    if (options.json) {
        writeOutput(JSON.stringify({ scope: target.scope, path: target.path }, null, 2), dependencies);
    } else {
        writeOutput(target.path, dependencies);
    }
    return target.path;
}

export function runSetDisableAllHooksCommand(
    enabled: boolean,
    options: HooksOutputOptions = {},
    dependencies: HooksCommandDependencies = {},
    manager?: Pick<ConfigManager, 'load' | 'set' | 'save' | 'getConfigPath'>,
): HooksToggleResult {
    const target = manager
        ? { scope: options.scope ?? 'project', manager }
        : resolveConfigWriteTarget(resolveHooksWriteTargetOptions(options));
    const current = target.manager.load({ mode: 'single' });
    target.manager.set({
        ...current,
        disableAllHooks: enabled,
    });
    target.manager.save();

    const result: HooksToggleResult = {
        scope: target.scope,
        configPath: target.manager.getConfigPath(),
        disableAllHooks: enabled,
    };

    if (options.json) {
        writeOutput(JSON.stringify(result, null, 2), dependencies);
    } else {
        writeOutput(`disableAllHooks=${enabled ? 'yes' : 'no'} scope=${result.scope} configPath=${result.configPath}`, dependencies);
    }

    return result;
}

export function runHooksCommand(fn: () => void): void {
    try {
        fn();
    } catch (error) {
        process.stderr.write(`hooks command failed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}

export interface HookMutationOptions extends HooksOutputOptions {
    event: string;
    matcher?: string;
}

export interface AddCommandHookOptions extends HookMutationOptions {
    command: string;
    async?: boolean;
    timeout?: number;
    shell?: string;
}

export interface AddHttpHookOptions extends HookMutationOptions {
    url: string;
    timeout?: number;
}

export interface AddPromptHookOptions extends HookMutationOptions {
    prompt: string;
    model?: string;
    timeout?: number;
}

export interface AddAgentHookOptions extends HookMutationOptions {
    prompt: string;
    agent?: string;
    model?: string;
    timeout?: number;
}

export interface RemoveHookOptions extends HooksOutputOptions {
    event: string;
    index: number;
}

export interface HookMutationResult {
    scope: ConfigWriteScope;
    configPath: string;
    event: HookEventName;
    handlerCount: number;
    mutation: 'added' | 'removed';
}

export function runAddHookCommand(
    handler: HookHandlerConfig,
    options: HookMutationOptions,
    dependencies: HooksCommandDependencies = {},
    manager?: Pick<ConfigManager, 'load' | 'set' | 'save' | 'getConfigPath'>,
): HookMutationResult {
    const eventName = resolveRequiredEventName(options.event);
    const target = resolveMutationTarget(options, manager);
    const current = target.manager.load({ mode: 'single' });
    const matcher = options.matcher?.trim() || undefined;
    const existingHooks = { ...(current.hooks ?? {}) } as HooksSettings;
    const existingGroups = existingHooks[eventName] ?? [];
    const groupIndex = matcher
        ? existingGroups.findIndex((group) => (group.matcher ?? '') === matcher)
        : existingGroups.findIndex((group) => group.matcher === undefined);
    const nextGroups: HookMatcherConfig[] = existingGroups.map((group) => ({ ...group, hooks: [...group.hooks] }));
    if (groupIndex >= 0) {
        nextGroups[groupIndex]!.hooks.push(handler);
    } else {
        nextGroups.push({
            ...(matcher !== undefined ? { matcher } : {}),
            hooks: [handler],
        });
    }
    existingHooks[eventName] = nextGroups;
    target.manager.set({ ...current, hooks: existingHooks });
    target.manager.save();
    const handlerCount = nextGroups.reduce((total, group) => total + group.hooks.length, 0);

    const result: HookMutationResult = {
        scope: target.scope,
        configPath: target.manager.getConfigPath(),
        event: eventName,
        handlerCount,
        mutation: 'added',
    };
    writeMutationOutput(result, options, dependencies);
    return result;
}

export function runRemoveHookCommand(
    options: RemoveHookOptions,
    dependencies: HooksCommandDependencies = {},
    manager?: Pick<ConfigManager, 'load' | 'set' | 'save' | 'getConfigPath'>,
): HookMutationResult {
    const eventName = resolveRequiredEventName(options.event);
    const target = resolveMutationTarget(options, manager);
    const current = target.manager.load({ mode: 'single' });
    const existingHooks = { ...(current.hooks ?? {}) } as HooksSettings;
    const existingGroups = existingHooks[eventName] ?? [];
    const flattened = existingGroups.flatMap((group, groupIndex) =>
        group.hooks.map((handler, handlerIndex) => ({ groupIndex, handlerIndex, handler })),
    );
    if (!Number.isInteger(options.index) || options.index < 0 || options.index >= flattened.length) {
        throw new Error(`hook index ${options.index} out of range for ${eventName} (have ${flattened.length})`);
    }
    const targetEntry = flattened[options.index]!;
    const nextGroups: HookMatcherConfig[] = existingGroups
        .map((group, groupIndex) => {
            if (groupIndex !== targetEntry.groupIndex) {
                return { ...group, hooks: [...group.hooks] };
            }
            const filtered = group.hooks.filter((_, handlerIndex) => handlerIndex !== targetEntry.handlerIndex);
            return filtered.length === 0 ? null : { ...group, hooks: filtered };
        })
        .filter((group): group is HookMatcherConfig => group !== null);

    if (nextGroups.length === 0) {
        delete existingHooks[eventName];
    } else {
        existingHooks[eventName] = nextGroups;
    }
    target.manager.set({ ...current, hooks: existingHooks });
    target.manager.save();
    const handlerCount = nextGroups.reduce((total, group) => total + group.hooks.length, 0);

    const result: HookMutationResult = {
        scope: target.scope,
        configPath: target.manager.getConfigPath(),
        event: eventName,
        handlerCount,
        mutation: 'removed',
    };
    writeMutationOutput(result, options, dependencies);
    return result;
}

export interface HookTestOptions extends HooksOutputOptions {
    event: string;
    toolName?: string;
    payloadJson?: string;
}

export interface HookTestResult {
    event: HookEventName;
    executedHandlers: number;
    blocked: boolean;
    reason?: string;
    additionalContexts: string[];
    systemMessages: string[];
    handlers: Array<{ type: string; error?: string; output?: string }>;
}

// NOTE: runTestHookCommand lives in ../integrations/hooks-test.ts to keep
// @xqoder/agent out of the strict-lint scope that includes src/application/system.
// Callers in src/commands (outside the strict scope) import it directly.

function resolveMutationTarget(
    options: HooksOutputOptions,
    manager?: Pick<ConfigManager, 'load' | 'set' | 'save' | 'getConfigPath'>,
): { scope: ConfigWriteScope; manager: Pick<ConfigManager, 'load' | 'set' | 'save' | 'getConfigPath'> } {
    if (manager) {
        return { scope: options.scope ?? 'project', manager };
    }
    return resolveConfigWriteTarget(resolveHooksWriteTargetOptions(options));
}

function resolveRequiredEventName(value: string | undefined): HookEventName {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error('hook --event is required');
    }
    if (!isHookEventName(normalized)) {
        throw new Error(`Unsupported hook event: ${normalized}. Supported events: ${SUPPORTED_HOOK_EVENTS.join(', ')}`);
    }
    return normalized;
}

function writeMutationOutput(
    result: HookMutationResult,
    options: HooksOutputOptions,
    dependencies: HooksCommandDependencies,
): void {
    if (options.json) {
        writeOutput(JSON.stringify(result, null, 2), dependencies);
    } else {
        writeOutput(
            `mutation=${result.mutation} event=${result.event} scope=${result.scope} handlerCount=${result.handlerCount} configPath=${result.configPath}`,
            dependencies,
        );
    }
}

function buildHookEventSummaries(hooks: HooksSettings): HookEventSummary[] {
    return SUPPORTED_HOOK_EVENTS.flatMap((event) => {
        const matcherGroups = hooks[event];
        if (!matcherGroups || matcherGroups.length === 0) {
            return [];
        }

        return [{
            event,
            matcherCount: matcherGroups.length,
            handlerCount: matcherGroups.reduce((total, matcherGroup) => total + matcherGroup.hooks.length, 0),
            types: Array.from(new Set(matcherGroups.flatMap((matcherGroup) => matcherGroup.hooks.map((hook) => hook.type)))).sort(),
        }];
    });
}

function buildHookEntries(
    sources: SourceConfigFragment[],
    eventFilter?: HookEventName,
): HookHandlerEntry[] {
    const entries: HookHandlerEntry[] = [];

    for (const source of sources) {
        const hooks = filterHooksByEvent(source.hooks ?? {}, eventFilter);
        for (const [event, matcherGroups] of Object.entries(hooks)) {
            if (!isHookEventName(event)) {
                continue;
            }
            for (const matcherGroup of matcherGroups) {
                for (const hook of matcherGroup.hooks) {
                    entries.push(toHookHandlerEntry(source, event, matcherGroup.matcher, hook));
                }
            }
        }
    }

    return entries.sort((left, right) => {
        const eventCompare = left.event.localeCompare(right.event);
        if (eventCompare !== 0) return eventCompare;
        const sourceCompare = left.source.localeCompare(right.source);
        if (sourceCompare !== 0) return sourceCompare;
        return left.type.localeCompare(right.type);
    });
}

function toHookHandlerEntry(
    source: SourceConfigFragment,
    event: HookEventName,
    matcher: string | undefined,
    hook: HookHandlerConfig,
): HookHandlerEntry {
    const baseEntry = {
        event,
        type: hook.type,
        source: describeConfigSourceKind(source.kind),
        sourcePath: source.path,
        ...(matcher !== undefined ? { matcher } : {}),
    };

    switch (hook.type) {
        case 'command':
            return {
                ...baseEntry,
                command: hook.command,
                ...(hook.async !== undefined ? { async: hook.async } : {}),
                ...(hook.timeout !== undefined ? { timeout: hook.timeout } : {}),
            };
        case 'http':
            return {
                ...baseEntry,
                url: hook.url,
                ...(hook.timeout !== undefined ? { timeout: hook.timeout } : {}),
            };
        case 'prompt':
            return {
                ...baseEntry,
                prompt: hook.prompt,
                ...(hook.model !== undefined ? { model: hook.model } : {}),
                ...(hook.timeout !== undefined ? { timeout: hook.timeout } : {}),
            };
        case 'agent':
            return {
                ...baseEntry,
                prompt: hook.prompt,
                ...(hook.agent !== undefined ? { agent: hook.agent } : {}),
                ...(hook.model !== undefined ? { model: hook.model } : {}),
                ...(hook.timeout !== undefined ? { timeout: hook.timeout } : {}),
            };
    }
}

function filterHooksByEvent(hooks: HooksSettings, eventFilter?: HookEventName): HooksSettings {
    if (!eventFilter) {
        return hooks;
    }

    return Object.fromEntries(
        Object.entries(hooks).filter(([event]) => event === eventFilter),
    ) as HooksSettings;
}

function countHandlers(hooks: HooksSettings): number {
    return Object.values(hooks).reduce(
        (total, matcherGroups) => total + matcherGroups.reduce((matcherTotal, matcherGroup) => matcherTotal + matcherGroup.hooks.length, 0),
        0,
    );
}

function formatHookEntry(entry: HookHandlerEntry): string {
    const parts = [
        `[${entry.source}]`,
        entry.event,
        `type=${entry.type}`,
        `matcher=${entry.matcher ?? '*'}`,
        `sourcePath=${entry.sourcePath}`,
    ];

    if (entry.command) parts.push(`command=${JSON.stringify(entry.command)}`);
    if (entry.url) parts.push(`url=${entry.url}`);
    if (entry.prompt) parts.push(`prompt=${JSON.stringify(entry.prompt)}`);
    if (entry.agent) parts.push(`agent=${entry.agent}`);
    if (entry.model) parts.push(`model=${entry.model}`);
    if (entry.async !== undefined) parts.push(`async=${entry.async ? 'yes' : 'no'}`);
    if (entry.timeout !== undefined) parts.push(`timeout=${entry.timeout}`);
    return parts.join(' ');
}

function resolveHookEventFilter(value: string | undefined): HookEventName | undefined {
    const normalized = normalizeOptionalToken(value);
    if (!normalized) {
        return undefined;
    }
    if (!isHookEventName(normalized)) {
        throw new Error(`Unsupported hook event: ${normalized}. Supported events: ${SUPPORTED_HOOK_EVENTS.join(', ')}`);
    }
    return normalized;
}

function normalizeOptionalToken(value: string | undefined): string | undefined {
    return value?.trim() || undefined;
}

function resolveHooksCwd(options: HooksOutputOptions): string | undefined {
    return normalizeOptionalToken(options.dir) ?? normalizeOptionalToken(options.cwd);
}

function resolveHooksSnapshotOptions(options: HooksOutputOptions): { cwd?: string } {
    const cwd = resolveHooksCwd(options);
    return cwd ? { cwd } : {};
}

function resolveHooksWriteTargetOptions(options: HooksOutputOptions): { cwd?: string; scope?: ConfigWriteScope } {
    const cwd = resolveHooksCwd(options);
    return {
        ...(cwd ? { cwd } : {}),
        ...(options.scope ? { scope: options.scope } : {}),
    };
}

function writeOutput(output: string, dependencies: HooksCommandDependencies): void {
    (dependencies.writeOutput ?? console.log)(output);
}
