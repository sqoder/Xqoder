/**
 * Workspace plugin discovery: Reads plugin path lists from the current project directory 
 * and merges them with plugins.paths from the configuration.
 * Supports:
 * - Built-in plugins
 * - Configuration-driven (config.plugins.paths / enabled / disabled)
 * - Workspace plugins (.xqoder/plugins.json or .xqoder/plugins/*.js)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WorkspacePluginsManifest {
    /** Plugin module path, relative to .xqoder directory or absolute path */
    paths?: string[];
}

const WORKSPACE_MANIFEST = '.xqoder/plugins.json';
const WORKSPACE_PLUGINS_DIR = '.xqoder/plugins';

/**
 * Reads plugin paths from the workspace: Checks .xqoder/plugins.json first, 
 * then scans .xqoder/plugins/*.js (if present).
 * Returns absolute paths for direct import.
 */
export function getWorkspacePluginPaths(cwd: string): string[] {
    const root = path.resolve(cwd);
    const manifestPath = path.join(root, WORKSPACE_MANIFEST);
    const pluginsDir = path.join(root, WORKSPACE_PLUGINS_DIR);
    const paths: string[] = [];

    if (fs.existsSync(manifestPath)) {
        try {
            const raw = fs.readFileSync(manifestPath, 'utf8');
            const manifest = JSON.parse(raw) as WorkspacePluginsManifest;
            if (Array.isArray(manifest.paths)) {
                for (const p of manifest.paths) {
                    const resolved = path.isAbsolute(p) ? p : path.resolve(root, p);
                    if (fs.existsSync(resolved)) {
                        paths.push(resolved);
                    }
                }
            }
        } catch {
            // Ignore corrupted or non-JSON manifests
        }
    }

    if (fs.existsSync(pluginsDir) && fs.statSync(pluginsDir).isDirectory()) {
        const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
        for (const ent of entries) {
            if (ent.isFile() && ent.name.endsWith('.js')) {
                paths.push(path.join(pluginsDir, ent.name));
            }
        }
    }

    return paths;
}

/**
 * Merges paths from configuration with paths discovered in the workspace.
 * Order: config.paths first, then workspace (allowing config-level overrides).
 */
export function mergePluginPaths(
    configPaths: string[] | undefined,
    cwd: string | undefined,
): string[] {
    const fromConfig = Array.isArray(configPaths) ? [...configPaths] : [];
    const fromWorkspace = cwd ? getWorkspacePluginPaths(cwd) : [];
    return [...fromConfig, ...fromWorkspace];
}
