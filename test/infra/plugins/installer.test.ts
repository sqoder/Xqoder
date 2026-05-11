// P18 — plugin installer (install local dir / tarball / npm pkg into
// ~/.xqoder/plugins/<name>/, remove, list).

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    installLocalPlugin,
    listInstalledPlugins,
    removeInstalledPlugin,
    resolvePluginsHome,
} from '../../../src/infra/plugins/installer.js';

function createFixturePlugin(name: string, version = '0.1.0'): string {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-plugin-src-'));
    fs.writeFileSync(
        path.join(src, 'xqoder.plugin.json'),
        JSON.stringify({ name, version }),
    );
    fs.writeFileSync(path.join(src, 'README.md'), `# ${name}\n`);
    return src;
}

describe('resolvePluginsHome', () => {
    it('returns <home>/.xqoder/plugins by default', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-home-'));
        expect(resolvePluginsHome({ homeDir: home })).toBe(
            path.join(home, '.xqoder', 'plugins'),
        );
    });

    it('respects XQODER_PLUGINS_HOME override', () => {
        const custom = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-plugins-'));
        expect(resolvePluginsHome({ envPluginsHome: custom })).toBe(custom);
    });
});

describe('installLocalPlugin', () => {
    it('copies the plugin into ~/.xqoder/plugins/<name>', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-home-'));
        const src = createFixturePlugin('my-plugin', '1.0.0');

        const result = await installLocalPlugin(src, { homeDir: home });

        expect(result.name).toBe('my-plugin');
        expect(result.version).toBe('1.0.0');
        const installedDir = path.join(home, '.xqoder', 'plugins', 'my-plugin');
        expect(result.dir).toBe(installedDir);
        expect(fs.existsSync(path.join(installedDir, 'xqoder.plugin.json'))).toBe(true);
        expect(fs.existsSync(path.join(installedDir, 'README.md'))).toBe(true);
    });

    it('refuses to overwrite an existing plugin unless force=true', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-home-'));
        const src1 = createFixturePlugin('overwrite', '1.0.0');
        const src2 = createFixturePlugin('overwrite', '2.0.0');

        await installLocalPlugin(src1, { homeDir: home });
        await expect(installLocalPlugin(src2, { homeDir: home })).rejects.toThrow(/already installed/i);

        const result = await installLocalPlugin(src2, { homeDir: home, force: true });
        expect(result.version).toBe('2.0.0');
    });

    it('rejects a source directory without xqoder.plugin.json', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-home-'));
        const src = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-plugin-src-'));
        await expect(installLocalPlugin(src, { homeDir: home })).rejects.toThrow(/xqoder\.plugin\.json/);
    });
});

describe('listInstalledPlugins', () => {
    it('returns an empty list when the home dir is missing', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-home-'));
        expect(listInstalledPlugins({ homeDir: home })).toEqual([]);
    });

    it('enumerates each valid plugin directory', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-home-'));
        await installLocalPlugin(createFixturePlugin('a', '0.1.0'), { homeDir: home });
        await installLocalPlugin(createFixturePlugin('b', '0.2.0'), { homeDir: home });

        const installed = listInstalledPlugins({ homeDir: home });
        expect(installed.map((p) => ({ name: p.name, version: p.version })).sort((l, r) => l.name.localeCompare(r.name)))
            .toEqual([
                { name: 'a', version: '0.1.0' },
                { name: 'b', version: '0.2.0' },
            ]);
    });

    it('skips directories without a valid manifest', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-home-'));
        const pluginsDir = path.join(home, '.xqoder', 'plugins');
        fs.mkdirSync(pluginsDir, { recursive: true });
        fs.mkdirSync(path.join(pluginsDir, 'broken'));
        fs.writeFileSync(path.join(pluginsDir, 'broken', 'xqoder.plugin.json'), '{not json');

        await installLocalPlugin(createFixturePlugin('good', '0.1.0'), { homeDir: home });

        const installed = listInstalledPlugins({ homeDir: home });
        expect(installed.map((p) => p.name)).toEqual(['good']);
    });
});

describe('installLocalPlugin symlink rejection', () => {
    it('rejects a source directory containing a symlink', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-home-'));
        const src = createFixturePlugin('symlink-plugin', '0.1.0');
        const target = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-target-'));
        fs.writeFileSync(path.join(target, 'secret.txt'), 'secret');
        fs.symlinkSync(path.join(target, 'secret.txt'), path.join(src, 'link.txt'));

        await expect(installLocalPlugin(src, { homeDir: home })).rejects.toThrow(/symlink/i);
    });
});

describe('removeInstalledPlugin', () => {
    it('deletes the plugin directory', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-home-'));
        const { dir } = await installLocalPlugin(createFixturePlugin('gone', '0.1.0'), { homeDir: home });
        expect(fs.existsSync(dir)).toBe(true);

        removeInstalledPlugin('gone', { homeDir: home });
        expect(fs.existsSync(dir)).toBe(false);
    });

    it('throws when the plugin is not installed', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-home-'));
        expect(() => removeInstalledPlugin('missing', { homeDir: home })).toThrow(/not installed/i);
    });
});
