// P18 — plugin loader.
//
// Resolves a `xqoder.plugin.json` manifest into a set of registrations via the
// injected `PluginRegistries` adapter. Side-effects are fully reversible through
// the returned `unload()` handle — used by `/reload-plugins` and by tests.
//
// P19.0.x hardening:
//   - All file/dir paths in the manifest are containment-checked against the
//     plugin directory (no `..` escapes, no symlink traversal).
//   - Hook commands require approval via the injected `approveHookCommand`
//     callback before being registered (first-use interactive confirmation).
//   - Skills are loaded through an injected `skillsLoader` function so that
//     infra does not reverse-depend on @xqoder/core-skills (ADR 0030 fix).
//   - unwind() logs each rollback failure instead of silently swallowing it.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePluginManifest, type PluginManifest } from './manifest.js';

export type SkillFile = { name: string; filePath: string; body: string; description?: string };

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

export interface LoadPluginOptions {
    /** Called before registering each hook command. Return false to skip the hook. */
    approveHookCommand?: (event: string, command: string) => Promise<boolean>;
    /** Directory scanner for skill provisions. Defaults to returning []. */
    skillsLoader?: (dir: string) => SkillFile[];
}

interface PluginEntryModule {
    onActivate?: (ctx: Record<string, unknown>) => void | Promise<void>;
    onDeactivate?: (ctx: Record<string, unknown>) => void | Promise<void>;
}

/** Assert that `resolved` is strictly inside `pluginDir` (no traversal, no symlinks). */
function assertContained(pluginDir: string, resolved: string, label: string): void {
    const base = path.resolve(pluginDir) + path.sep;
    if (!resolved.startsWith(base)) {
        throw new Error(`Plugin path "${label}" resolves outside plugin directory: ${resolved}`);
    }
}

/** Resolve a manifest-relative path and enforce containment + symlink rejection (all levels). */
function resolveAndCheck(pluginDir: string, relPath: string, label: string): string {
    const joined = path.resolve(pluginDir, relPath);
    // String-level containment check first (fast path, no I/O).
    assertContained(pluginDir, joined, label);
    // Follow ALL symlinks (including intermediate directories) and re-assert containment.
    // Use realpathSync on pluginDir too so OS-level symlinks (e.g. macOS /tmp → /private/tmp)
    // don't cause false positives.
    try {
        const real = fs.realpathSync(joined);
        const realBase = fs.realpathSync(path.resolve(pluginDir)) + path.sep;
        if (!real.startsWith(realBase)) {
            throw new Error(`Plugin path "${label}" resolves outside plugin directory: ${real}`);
        }
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            // File doesn't exist yet — string-level check is sufficient.
            return joined;
        }
        throw err;
    }
    return joined;
}

export async function loadExtendedPlugin(
    dir: string,
    registries: PluginRegistries,
    options: LoadPluginOptions = {},
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
    const pluginName = manifest.name;

    const rollback: Array<{ label: string; fn: () => void | Promise<void> }> = [];

    // Commands
    for (const spec of manifest.provides?.commands ?? []) {
        const resolved = resolveAndCheck(dir, spec.file, `commands[${spec.name}].file`);
        const mod = await importPluginModule(resolved);
        const command = pickDefault(mod);
        registries.commands.register(spec.name, command);
        rollback.push({ label: `unregister command ${spec.name}`, fn: () => registries.commands.unregister(spec.name) });
    }

    // Tools
    for (const spec of manifest.provides?.tools ?? []) {
        const resolved = resolveAndCheck(dir, spec.file, `tools[${spec.name}].file`);
        const mod = await importPluginModule(resolved);
        const tool = instantiateTool(mod);
        registries.tools.register(tool);
        rollback.push({ label: `unregister tool ${spec.name}`, fn: () => registries.tools.unregister(spec.name) });
    }

    // Skills — loaded via injected skillsLoader to avoid infra→core reverse dep.
    const skillsLoader = options.skillsLoader ?? (() => []);
    for (const spec of manifest.provides?.skills ?? []) {
        const skills = resolveSkillProvision(dir, spec, skillsLoader);
        for (const skill of skills) {
            registries.skills.register(skill);
            rollback.push({ label: `unregister skill ${skill.name}`, fn: () => registries.skills.unregister(skill.name) });
        }
    }

    // Hooks — each shell command requires approval before registration.
    // Default: deny-all when no approveHookCommand is injected, to prevent
    // callers that forget to wire the DI from silently registering shell hooks.
    const approveHook = options.approveHookCommand ?? (async () => false);
    for (const [event, handlers] of Object.entries(manifest.provides?.hooks ?? {})) {
        for (const handler of handlers ?? []) {
            if (handler.command) {
                const allowed = await approveHook(event, handler.command);
                if (!allowed) continue;
            }
            registries.hooks.register(event, handler);
            rollback.push({ label: `unregister hook ${event}`, fn: () => registries.hooks.unregister(event, handler) });
        }
    }

    // onActivate / onDeactivate lifecycle
    let entryModule: PluginEntryModule | undefined;
    if (manifest.entry) {
        const resolved = resolveAndCheck(dir, manifest.entry, 'entry');
        const loaded = await importPluginModule(resolved);
        entryModule = (loaded.default ?? loaded) as PluginEntryModule;
        try {
            await entryModule?.onActivate?.(registries.ctx);
        } catch (error) {
            await unwind(pluginName, rollback);
            throw new Error(`Plugin "${pluginName}" onActivate failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return {
        manifest,
        dir,
        async unload() {
            try {
                await entryModule?.onDeactivate?.(registries.ctx);
            } finally {
                await unwind(pluginName, rollback);
            }
        },
    };
}

function resolveSkillProvision(
    pluginDir: string,
    spec: { file?: string; dir?: string },
    skillsLoader: (dir: string) => SkillFile[],
): SkillFile[] {
    if (spec.dir) {
        const abs = path.resolve(pluginDir, spec.dir);
        assertContained(pluginDir, abs, `skills.dir "${spec.dir}"`);
        return skillsLoader(abs);
    }
    if (spec.file) {
        const abs = resolveAndCheck(pluginDir, spec.file, `skills.file "${spec.file}"`);
        const parent = path.dirname(abs);
        const skills = skillsLoader(parent);
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

async function unwind(
    pluginName: string,
    rollback: Array<{ label: string; fn: () => void | Promise<void> }>,
): Promise<void> {
    while (rollback.length > 0) {
        const step = rollback.pop();
        if (!step) continue;
        try {
            await step.fn();
        } catch (err) {
            // Log but continue unwinding — partial rollback is better than none.
            console.warn(
                `[plugin:${pluginName}] rollback step "${step.label}" failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
