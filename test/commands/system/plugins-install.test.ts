// P18 — CLI integration for `xqoder plugin install/remove/enable/disable/list`.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    createPluginsCommand,
    runInstallPluginCommand,
    runListPluginsCommand,
    runRemovePluginCommand,
    runSetPluginEnabledCommand,
} from '../../../src/commands/system/plugins.js';

interface Harness {
    home: string;
    reset(): void;
    outputs: string[];
    errors: string[];
    dependencies: {
        writeOutput: (s: string) => void;
        writeError: (s: string) => void;
        discover: () => Promise<{ commands: unknown[]; report: unknown[] }>;
        configManager: { load: () => Record<string, unknown> };
    };
}

let harness: Harness;

beforeEach(() => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-cli-'));
    process.env.XQODER_PLUGINS_HOME = path.join(home, '.xqoder', 'plugins');
    const outputs: string[] = [];
    const errors: string[] = [];
    harness = {
        home,
        reset: () => {
            outputs.length = 0;
            errors.length = 0;
        },
        outputs,
        errors,
        dependencies: {
            writeOutput: (s) => outputs.push(s),
            writeError: (s) => errors.push(s),
            discover: async () => ({ commands: [], report: [] }),
            configManager: { load: () => ({ plugins: {} }) },
        },
    };
});

afterEach(() => {
    delete process.env.XQODER_PLUGINS_HOME;
});

function createPluginFixture(name: string, version = '0.1.0'): string {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-plugin-src-'));
    fs.writeFileSync(
        path.join(src, 'xqoder.plugin.json'),
        JSON.stringify({ name, version }),
    );
    return src;
}

describe('runInstallPluginCommand', () => {
    it('installs a local plugin and writes a confirmation line', async () => {
        const src = createPluginFixture('cli-plugin', '1.0.0');
        const result = await runInstallPluginCommand({ source: src }, harness.dependencies);
        expect(result.name).toBe('cli-plugin');
        expect(harness.outputs.join('\n')).toMatch(/installed cli-plugin@1\.0\.0/);
    });

    it('rejects a duplicate install without --force', async () => {
        const src = createPluginFixture('dup', '1.0.0');
        await runInstallPluginCommand({ source: src }, harness.dependencies);
        await expect(runInstallPluginCommand({ source: src }, harness.dependencies)).rejects.toThrow(/already installed/);
    });
});

describe('runListPluginsCommand', () => {
    it('includes installed plugins in text output', async () => {
        const src = createPluginFixture('listed', '0.1.0');
        await runInstallPluginCommand({ source: src }, harness.dependencies);
        harness.reset();

        await runListPluginsCommand({}, harness.dependencies);
        expect(harness.outputs.find((line) => line.startsWith('listed '))).toMatch(/version=0\.1\.0/);
    });

    it('includes installed plugins in JSON output', async () => {
        const src = createPluginFixture('jsoned', '0.1.0');
        await runInstallPluginCommand({ source: src }, harness.dependencies);
        harness.reset();

        await runListPluginsCommand({ json: true }, harness.dependencies);
        const payload = JSON.parse(harness.outputs[0] ?? '{}') as {
            installed?: Array<{ name: string; enabled: boolean }>;
        };
        expect(payload.installed?.map((p) => p.name)).toContain('jsoned');
        expect(payload.installed?.every((p) => p.enabled === true)).toBe(true);
    });
});

describe('runSetPluginEnabledCommand + runRemovePluginCommand', () => {
    it('disable and enable flip state, remove deletes the dir', async () => {
        const src = createPluginFixture('flippable', '0.1.0');
        const installed = await runInstallPluginCommand({ source: src }, harness.dependencies);

        runSetPluginEnabledCommand({ name: 'flippable', enabled: false }, harness.dependencies);
        runSetPluginEnabledCommand({ name: 'flippable', enabled: true }, harness.dependencies);

        runRemovePluginCommand({ name: 'flippable' }, harness.dependencies);
        expect(fs.existsSync(installed.dir)).toBe(false);
    });

    it('remove errors when the plugin is missing', () => {
        expect(() => runRemovePluginCommand({ name: 'nope' }, harness.dependencies))
            .toThrow(/not installed/i);
    });
});

describe('createPluginsCommand', () => {
    it('exposes the new subcommands alongside list', () => {
        const cmd = createPluginsCommand(harness.dependencies);
        const subcommandNames = cmd.commands.map((c) => c.name()).sort();
        expect(subcommandNames).toEqual(['disable', 'enable', 'home', 'install', 'list', 'remove'].sort());
        const remove = cmd.commands.find((c) => c.name() === 'remove');
        expect(remove?.aliases()).toContain('uninstall');
    });
});
