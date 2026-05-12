// P18 — xqoder.plugin.json manifest types and validator.
//
// Kept deliberately small and dependency-free. The shape mirrors the contract
// documented in docs/openclaude-parity/phase-18-plugins.md. Validation returns
// structured errors rather than throwing so callers (CLI vs. runtime loader)
// can surface them differently.

import { SUPPORTED_HOOK_EVENTS, type HookEventName } from '@xqoder/shared';

export interface PluginCommandProvision {
    readonly name: string;
    readonly file: string;
}

export interface PluginToolProvision {
    readonly name: string;
    readonly file: string;
}

export interface PluginSkillProvision {
    readonly file?: string;
    readonly dir?: string;
}

export interface PluginHookProvision {
    readonly command: string;
    readonly matcher?: string;
    readonly timeout?: number;
}

export interface PluginProvides {
    readonly commands?: readonly PluginCommandProvision[];
    readonly tools?: readonly PluginToolProvision[];
    readonly skills?: readonly PluginSkillProvision[];
    readonly hooks?: Partial<Record<HookEventName, readonly PluginHookProvision[]>>;
}

export interface PluginManifest {
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly entry?: string;
    readonly provides?: PluginProvides;
    readonly engines?: { readonly xqoder?: string };
}

export interface PluginManifestParseError {
    readonly path: string;
    readonly message: string;
}

export type PluginManifestParseResult =
    | { ok: true; manifest: PluginManifest }
    | { ok: false; errors: PluginManifestParseError[] };

export function parsePluginManifest(input: unknown): PluginManifestParseResult {
    const errors: PluginManifestParseError[] = [];
    const push = (path: string, message: string): void => {
        errors.push({ path, message });
    };

    if (!isObject(input)) {
        return { ok: false, errors: [{ path: '$', message: 'manifest must be an object' }] };
    }

    const name = input.name;
    if (typeof name !== 'string' || name.length === 0) {
        push('name', 'name must be a non-empty string');
    }

    const version = input.version;
    if (typeof version !== 'string' || version.length === 0) {
        push('version', 'version must be a non-empty string');
    }

    const description = input.description;
    if (description !== undefined && typeof description !== 'string') {
        push('description', 'description must be a string');
    }

    const entry = input.entry;
    if (entry !== undefined && typeof entry !== 'string') {
        push('entry', 'entry must be a string');
    }

    const provides = input.provides;
    let parsedProvides: PluginProvides | undefined;
    if (provides !== undefined) {
        if (!isObject(provides)) {
            push('provides', 'provides must be an object');
        } else {
            parsedProvides = parseProvides(provides, push);
        }
    }

    const engines = input.engines;
    let parsedEngines: PluginManifest['engines'];
    if (engines !== undefined) {
        if (!isObject(engines)) {
            push('engines', 'engines must be an object');
        } else if (engines.xqoder !== undefined && typeof engines.xqoder !== 'string') {
            push('engines.xqoder', 'engines.xqoder must be a string');
        } else {
            parsedEngines = typeof engines.xqoder === 'string' ? { xqoder: engines.xqoder } : {};
        }
    }

    if (errors.length > 0) {
        return { ok: false, errors };
    }

    const manifest: PluginManifest = {
        name: name as string,
        version: version as string,
        ...(typeof description === 'string' ? { description } : {}),
        ...(typeof entry === 'string' ? { entry } : {}),
        ...(parsedProvides ? { provides: parsedProvides } : {}),
        ...(parsedEngines ? { engines: parsedEngines } : {}),
    };
    return { ok: true, manifest };
}

function parseProvides(
    provides: Record<string, unknown>,
    push: (path: string, message: string) => void,
): PluginProvides {
    const result: Mutable<PluginProvides> = {};

    if (provides.commands !== undefined) {
        if (!Array.isArray(provides.commands)) {
            push('provides.commands', 'commands must be an array');
        } else {
            const commands: PluginCommandProvision[] = [];
            provides.commands.forEach((entry, index) => {
                if (!isObject(entry)) {
                    push(`provides.commands[${index}]`, 'command entry must be an object');
                    return;
                }
                if (typeof entry.name !== 'string' || entry.name.length === 0) {
                    push(`provides.commands[${index}].name`, 'command.name must be a non-empty string');
                }
                if (typeof entry.file !== 'string' || entry.file.length === 0) {
                    push(`provides.commands[${index}].file`, 'command.file must be a non-empty string');
                }
                if (typeof entry.name === 'string' && typeof entry.file === 'string') {
                    commands.push({ name: entry.name, file: entry.file });
                }
            });
            result.commands = commands;
        }
    }

    if (provides.tools !== undefined) {
        if (!Array.isArray(provides.tools)) {
            push('provides.tools', 'tools must be an array');
        } else {
            const tools: PluginToolProvision[] = [];
            provides.tools.forEach((entry, index) => {
                if (!isObject(entry)) {
                    push(`provides.tools[${index}]`, 'tool entry must be an object');
                    return;
                }
                if (typeof entry.name !== 'string' || entry.name.length === 0) {
                    push(`provides.tools[${index}].name`, 'tool.name must be a non-empty string');
                }
                if (typeof entry.file !== 'string' || entry.file.length === 0) {
                    push(`provides.tools[${index}].file`, 'tool.file must be a non-empty string');
                }
                if (typeof entry.name === 'string' && typeof entry.file === 'string') {
                    tools.push({ name: entry.name, file: entry.file });
                }
            });
            result.tools = tools;
        }
    }

    if (provides.skills !== undefined) {
        if (!Array.isArray(provides.skills)) {
            push('provides.skills', 'skills must be an array');
        } else {
            const skills: PluginSkillProvision[] = [];
            provides.skills.forEach((entry, index) => {
                if (!isObject(entry)) {
                    push(`provides.skills[${index}]`, 'skill entry must be an object');
                    return;
                }
                const file = typeof entry.file === 'string' && entry.file.length > 0 ? entry.file : undefined;
                const dir = typeof entry.dir === 'string' && entry.dir.length > 0 ? entry.dir : undefined;
                if (!file && !dir) {
                    push(`provides.skills[${index}]`, 'skill entry must supply either file or dir');
                    return;
                }
                skills.push({
                    ...(file ? { file } : {}),
                    ...(dir ? { dir } : {}),
                });
            });
            result.skills = skills;
        }
    }

    if (provides.hooks !== undefined) {
        if (!isObject(provides.hooks)) {
            push('provides.hooks', 'hooks must be an object');
        } else {
            const hooks: Mutable<NonNullable<PluginProvides['hooks']>> = {};
            for (const [eventName, entries] of Object.entries(provides.hooks)) {
                if (!(SUPPORTED_HOOK_EVENTS as readonly string[]).includes(eventName)) {
                    push(`provides.hooks.${eventName}`, `unknown hook event: ${eventName}`);
                    continue;
                }
                if (!Array.isArray(entries)) {
                    push(`provides.hooks.${eventName}`, 'hook entries must be an array');
                    continue;
                }
                const parsed: PluginHookProvision[] = [];
                entries.forEach((entry, index) => {
                    if (!isObject(entry)) {
                        push(`provides.hooks.${eventName}[${index}]`, 'hook entry must be an object');
                        return;
                    }
                    if (typeof entry.command !== 'string' || entry.command.length === 0) {
                        push(`provides.hooks.${eventName}[${index}].command`, 'hook.command must be a non-empty string');
                        return;
                    }
                    parsed.push({
                        command: entry.command,
                        ...(typeof entry.matcher === 'string' ? { matcher: entry.matcher } : {}),
                        ...(typeof entry.timeout === 'number' ? { timeout: entry.timeout } : {}),
                    });
                });
                hooks[eventName as HookEventName] = parsed;
            }
            result.hooks = hooks;
        }
    }

    return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
