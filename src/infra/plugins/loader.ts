// P18 — plugin loader.
//
// Resolves a `xqoder.plugin.json` manifest into a set of registrations via the
// injected `PluginRegistries` adapter. Side-effects are fully reversible through
// the returned `unload()` handle — used by `/reload-plugins` and by tests.
//
// Skills are loaded through `loadSkillsDir` (core-skills), honouring the
// ADR 0027 follow-up: plugin-bundled `skills.dir` entries reuse the same
// directory scanner as the project/user skills search roots.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSkillsDir, type SkillFile } from '@xqoder/core-skills';
import { parsePluginManifest, type PluginManifest } from './manifest.js';

export interface PluginCommandRegistry {
    register(name: string, command: unknown): void;
    unregister(name: string): void;
}

export interface PluginToolRegistry {
    register(tool: unknown): void;
    unregister(name: string): void;
}

export interface PluginSkillRegistry {
    register(skill: SkillFile): void;
    unregister(name: string): void;
}

export interface PluginHookHandler {
    readonly command?: string;
    readonly matcher?: string;
    readonly timeout?: number;
}

export interface PluginHookRegistry {
    register(event: string, handler: PluginHookHandler): void;
    unregister(event: string, handler: PluginHookHandler): void;
}

export interface PluginRegistries {
    readonly commands: PluginCommandRegistry;
    readonly tools: PluginToolRegistry;
    readonly skills: PluginSkillRegistry;
    readonly hooks: PluginHookRegistry;
    readonly ctx: Record<string, unknown>;
}

export interface LoadedPlugin {
    readonly manifest: PluginManifest;
    readonly dir: string;
    unload(): Promise<void>;
}

interface PluginEntryModule {
    onActivate?: (ctx: Record<string, unknown>) => void | Promise<void>;
    onDeactivate?: (ctx: Record<string, unknown>) => void | Promise<void>;
}

export async function loadExtendedPlugin(
    dir: string,
    registries: PluginRegistries,
): Promise<LoadedPlugin> {
    const manifestPath = path.join(dir, 'xqoder.plugin.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`xqoder.plugin.json not found under ${dir}`);
    }

    const raw = fs.readFileSync(manifestPath, 'utf-8');
    let parsedJson: unknown;
    try {
        parsedJson = JSON.parse(raw);
    } catch (error) {
        throw new Error(`Failed to parse ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const parsed = parsePluginManifest(parsedJson);
    if (parsed.ok !== true) {
        const messages = parsed.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
        throw new Error(`Invalid xqoder.plugin.json (${manifestPath}): ${messages}`);
    }
    const { manifest } = parsed;

    const rollback: Array<() => void | Promise<void>> = [];

    // Commands
    for (const spec of manifest.provides?.commands ?? []) {
        const mod = await importPluginModule(path.join(dir, spec.file));
        const command = pickDefault(mod);
        registries.commands.register(spec.name, command);
        rollback.push(() => registries.commands.unregister(spec.name));
    }

    // Tools
    for (const spec of manifest.provides?.tools ?? []) {
        const mod = await importPluginModule(path.join(dir, spec.file));
        const tool = instantiateTool(mod);
        registries.tools.register(tool);
        rollback.push(() => registries.tools.unregister(spec.name));
    }

    // Skills — reuse the core-skills loader so frontmatter validation,
    // name derivation, and bundled-folder semantics stay identical to the
    // project-local / user-level search roots (ADR 0027 follow-up).
    for (const spec of manifest.provides?.skills ?? []) {
        const skills = resolveSkillProvision(dir, spec);
        for (const skill of skills) {
            registries.skills.register(skill);
            rollback.push(() => registries.skills.unregister(skill.name));
        }
    }

    // Hooks — plugin-level hook handlers are recorded verbatim; the runtime
    // hook engine remains the source of truth for execution semantics.
    for (const [event, handlers] of Object.entries(manifest.provides?.hooks ?? {})) {
        for (const handler of handlers ?? []) {
            registries.hooks.register(event, handler);
            rollback.push(() => registries.hooks.unregister(event, handler));
        }
    }

    // onActivate / onDeactivate lifecycle
    let entryModule: PluginEntryModule | undefined;
    if (manifest.entry) {
        const loaded = await importPluginModule(path.join(dir, manifest.entry));
        entryModule = (loaded.default ?? loaded) as PluginEntryModule;
        try {
            await entryModule?.onActivate?.(registries.ctx);
        } catch (error) {
            await unwind(rollback);
            throw new Error(`Plugin "${manifest.name}" onActivate failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return {
        manifest,
        dir,
        async unload() {
            try {
                await entryModule?.onDeactivate?.(registries.ctx);
            } finally {
                await unwind(rollback);
            }
        },
    };
}

function resolveSkillProvision(pluginDir: string, spec: { file?: string; dir?: string }): SkillFile[] {
    if (spec.dir) {
        const abs = path.resolve(pluginDir, spec.dir);
        return loadSkillsDir(abs);
    }
    if (spec.file) {
        const abs = path.resolve(pluginDir, spec.file);
        // loadSkillsDir expects a directory, so we point it at the file's
        // parent. Because parseSkillAt derives the name from filename/
        // SKILL.md convention, the sibling files could also leak in —
        // guard by isolating the file to a single entry.
        const parent = path.dirname(abs);
        const skills = loadSkillsDir(parent);
        return skills.filter((skill) => skill.filePath === abs);
    }
    return [];
}

async function importPluginModule(modulePath: string): Promise<Record<string, unknown>> {
    const url = pathToFileURL(modulePath).href;
    return (await import(url)) as Record<string, unknown>;
}

function pickDefault(mod: Record<string, unknown>): unknown {
    return (mod as { default?: unknown }).default ?? mod;
}

function instantiateTool(mod: Record<string, unknown>): unknown {
    const Ctor = (mod as { default?: unknown }).default ?? mod;
    if (typeof Ctor === 'function') {
        return new (Ctor as new () => unknown)();
    }
    return Ctor;
}

async function unwind(rollback: Array<() => void | Promise<void>>): Promise<void> {
    while (rollback.length > 0) {
        const step = rollback.pop();
        if (!step) continue;
        try {
            await step();
        } catch {
            // Continue unwinding even if a single rollback step throws.
        }
    }
}
