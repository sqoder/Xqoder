import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getWorkspacePluginPaths, mergePluginPaths } from './plugin-discovery.js';

describe('plugin-discovery', () => {
    it('getWorkspacePluginPaths returns [] when no .xqoder/plugins.json or .xqoder/plugins', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-plugin-discovery-'));
        try {
            expect(getWorkspacePluginPaths(dir)).toEqual([]);
        } finally {
            fs.rmSync(dir, { recursive: true });
        }
    });

    it('getWorkspacePluginPaths reads paths from .xqoder/plugins.json', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-plugin-discovery-'));
        const xqoderDir = path.join(dir, '.xqoder');
        fs.mkdirSync(xqoderDir, { recursive: true });
        const manifestPath = path.join(xqoderDir, 'plugins.json');
        const pluginPath = path.join(dir, 'my-plugin.js');
        fs.writeFileSync(pluginPath, '');
        fs.writeFileSync(manifestPath, JSON.stringify({ paths: ['my-plugin.js'] }));
        try {
            const result = getWorkspacePluginPaths(dir);
            expect(result).toHaveLength(1);
            expect(result[0]).toBe(pluginPath);
        } finally {
            fs.rmSync(dir, { recursive: true });
        }
    });

    it('mergePluginPaths merges config paths and workspace paths', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-merge-'));
        const xqoderDir = path.join(dir, '.xqoder');
        fs.mkdirSync(xqoderDir, { recursive: true });
        fs.writeFileSync(path.join(xqoderDir, 'plugins.json'), JSON.stringify({ paths: ['w.js'] }));
        fs.writeFileSync(path.join(dir, 'w.js'), '');
        try {
            const merged = mergePluginPaths(['/global/a.js'], dir);
            expect(merged).toContain('/global/a.js');
            expect(merged.some((p) => p.endsWith('w.js'))).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true });
        }
    });
});
