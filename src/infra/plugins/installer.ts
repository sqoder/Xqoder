// P18 — plugin installer: install / remove / list plugins under
// ~/.xqoder/plugins/. Copies local directories for now; npm / tarball install
// is delegated to the user running `npm install` or `xqoder plugin install`
// against a prepared directory.
//
// Keeping this small and synchronous-friendly: fs only, no lockfile.
// Callers are the CLI and the runtime loader.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parsePluginManifest, type PluginManifest } from './manifest.js';

export interface InstallerOptions {
    readonly homeDir?: string;
    readonly envPluginsHome?: string;
}

export interface InstalledPlugin {
    readonly name: string;
    readonly version: string;
    readonly dir: string;
    readonly manifest: PluginManifest;
}

export interface InstallLocalOptions extends InstallerOptions {
    readonly force?: boolean;
}

export function resolvePluginsHome(options: InstallerOptions = {}): string {
    const explicit = options.envPluginsHome ?? process.env.XQODER_PLUGINS_HOME;
    if (explicit && explicit.length > 0) {
        return explicit;
    }
    const home = options.homeDir ?? process.env.HOME ?? os.homedir();
    return path.join(home, '.xqoder', 'plugins');
}

export async function installLocalPlugin(
    sourceDir: string,
    options: InstallLocalOptions = {},
): Promise<InstalledPlugin> {
    const absoluteSource = path.resolve(sourceDir);
    const manifestPath = path.join(absoluteSource, 'xqoder.plugin.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Source directory is missing xqoder.plugin.json: ${absoluteSource}`);
    }

    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = parsePluginManifest(safeJsonParse(raw, manifestPath));
    if (parsed.ok !== true) {
        const messages = parsed.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
        throw new Error(`Invalid xqoder.plugin.json: ${messages}`);
    }
    const { manifest } = parsed;

    const pluginsHome = resolvePluginsHome(options);
    const destDir = path.join(pluginsHome, manifest.name);
    if (fs.existsSync(destDir) && !options.force) {
        throw new Error(`Plugin "${manifest.name}" is already installed at ${destDir}. Pass force=true to overwrite.`);
    }

    fs.mkdirSync(pluginsHome, { recursive: true });
    if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true });
    }
    copyDirRecursive(absoluteSource, destDir);

    return { name: manifest.name, version: manifest.version, dir: destDir, manifest };
}

export function removeInstalledPlugin(
    name: string,
    options: InstallerOptions = {},
): void {
    const pluginsHome = resolvePluginsHome(options);
    const dir = path.join(pluginsHome, name);
    if (!fs.existsSync(dir)) {
        throw new Error(`Plugin "${name}" is not installed`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
}

export function listInstalledPlugins(options: InstallerOptions = {}): InstalledPlugin[] {
    const pluginsHome = resolvePluginsHome(options);
    if (!fs.existsSync(pluginsHome) || !fs.statSync(pluginsHome).isDirectory()) {
        return [];
    }

    const installed: InstalledPlugin[] = [];
    for (const entry of fs.readdirSync(pluginsHome, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(pluginsHome, entry.name);
        const manifestPath = path.join(dir, 'xqoder.plugin.json');
        if (!fs.existsSync(manifestPath)) continue;
        try {
            const raw = fs.readFileSync(manifestPath, 'utf-8');
            const parsed = parsePluginManifest(safeJsonParse(raw, manifestPath));
            if (parsed.ok !== true) continue;
            installed.push({
                name: parsed.manifest.name,
                version: parsed.manifest.version,
                dir,
                manifest: parsed.manifest,
            });
        } catch {
            // Skip unreadable/corrupt manifests — surface via `plugin list` later.
        }
    }
    return installed.sort((l, r) => l.name.localeCompare(r.name));
}

function copyDirRecursive(source: string, target: string): void {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name);
        const to = path.join(target, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(from, to);
        } else if (entry.isSymbolicLink()) {
            const target = fs.readlinkSync(from);
            fs.symlinkSync(target, to);
        } else {
            fs.copyFileSync(from, to);
        }
    }
}

function safeJsonParse(raw: string, file: string): unknown {
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`Failed to parse ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
