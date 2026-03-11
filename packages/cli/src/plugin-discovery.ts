/**
 * 工作区插件发现：从当前项目目录读取插件路径列表，与配置中的 plugins.paths 合并使用。
 * 支持：
 * - 内建插件（built-in）
 * - 配置驱动（config.plugins.paths / enabled / disabled）
 * - 工作区插件（.xqoder/plugins.json 或 .xqoder/plugins/*.js）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WorkspacePluginsManifest {
    /** 插件模块路径，相对 .xqoder 目录或绝对路径 */
    paths?: string[];
}

const WORKSPACE_MANIFEST = '.xqoder/plugins.json';
const WORKSPACE_PLUGINS_DIR = '.xqoder/plugins';

/**
 * 从工作区读取插件路径：先查 .xqoder/plugins.json，再扫描 .xqoder/plugins/*.js（如存在）。
 * 返回的路径为绝对路径，便于后续 import。
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
            // 忽略损坏或非 JSON 的 manifest
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
 * 合并配置中的 paths 与工作区发现的 paths。顺序：先 config.paths，再 workspace，便于配置覆盖。
 */
export function mergePluginPaths(
    configPaths: string[] | undefined,
    cwd: string | undefined,
): string[] {
    const fromConfig = Array.isArray(configPaths) ? [...configPaths] : [];
    const fromWorkspace = cwd ? getWorkspacePluginPaths(cwd) : [];
    return [...fromConfig, ...fromWorkspace];
}
