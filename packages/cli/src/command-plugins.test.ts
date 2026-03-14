import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { definePlugin } from '@xqoder/plugin-sdk';
import { discoverCommandRegistrations, discoverCommandRegistrationsWithReport, getBuiltInCommandRegistrations, type CommanderCommandRegistration } from './command-plugins.js';

function createRegistration(name: string): CommanderCommandRegistration {
    return {
        name,
        description: `${name} command`,
        kind: 'commander',
        createCommand: () => new Command(name),
        run: async () => {},
    };
}

describe('command plugins', () => {
    it('exposes built-in command registrations', () => {
        const registrations = getBuiltInCommandRegistrations();
        const names = registrations.map((registration) => registration.name);

        expect(names).toContain('chat');
        expect(names).toContain('tui');
        expect(names).toContain('build');
    });

    it('supports enable disable and compatibility filtering', async () => {
        const compatiblePlugin = definePlugin({
            manifest: {
                name: 'custom-cli-plugin',
                version: '0.1.0',
                enabledByDefault: true,
                compatibility: { product: 'xqoder', versionRange: '^0.1.0' },
            },
            setup(api) {
                api.registerCommand(createRegistration('custom'));
            },
        });
        const incompatiblePlugin = definePlugin({
            manifest: {
                name: 'incompatible-cli-plugin',
                version: '0.1.0',
                enabledByDefault: true,
                compatibility: { product: 'xqoder', versionRange: '^9.0.0' },
            },
            setup(api) {
                api.registerCommand(createRegistration('broken'));
            },
        });

        const enabled = await discoverCommandRegistrations({
            productVersion: '0.1.0',
            pluginConfig: { enabled: ['custom-cli-plugin'], paths: [] },
            plugins: [compatiblePlugin],
        });
        const incompatible = await discoverCommandRegistrations({
            productVersion: '0.1.0',
            pluginConfig: { paths: [] },
            plugins: [incompatiblePlugin],
        });
        const allowIncompatible = await discoverCommandRegistrations({
            productVersion: '0.1.0',
            pluginConfig: { allowIncompatible: true, paths: [] },
            plugins: [incompatiblePlugin],
        });

        expect(enabled.map((registration) => registration.name)).toContain('custom');
        expect(incompatible.map((registration) => registration.name)).not.toContain('broken');
        expect(allowIncompatible.map((registration) => registration.name)).toContain('broken');
    });

    it('returns plugin load reports for loaded and incompatible plugins', async () => {
        const loadedPlugin = definePlugin({
            manifest: {
                name: 'loaded-plugin',
                version: '0.1.0',
                compatibility: { product: 'xqoder', versionRange: '^0.1.0' },
            },
            setup(api) {
                api.registerCommand(createRegistration('loaded'));
            },
        });
        const incompatiblePlugin = definePlugin({
            manifest: {
                name: 'future-plugin',
                version: '9.0.0',
                compatibility: { product: 'xqoder', versionRange: '^9.0.0' },
            },
            setup(api) {
                api.registerCommand(createRegistration('future'));
            },
        });

        const result = await discoverCommandRegistrationsWithReport({
            productVersion: '0.1.0',
            plugins: [loadedPlugin, incompatiblePlugin],
            pluginConfig: { paths: [] },
        });

        expect(result.commands.map((registration) => registration.name)).toContain('loaded');
        expect(result.report).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'loaded-plugin', status: 'loaded', source: 'injected' }),
            expect.objectContaining({ name: 'future-plugin', status: 'incompatible', source: 'injected' }),
        ]));
    });

    it('keeps workflow commands disabled by default while remote commands stay available', async () => {
        const result = await discoverCommandRegistrationsWithReport({
            productVersion: '0.1.0',
            pluginConfig: { paths: [] },
        });

        const names = result.commands.map((registration) => registration.name);

        expect(names).toContain('chat');
        expect(names).not.toContain('build');
        expect(names).not.toContain('lsp');
        expect(names).not.toContain('rollbacks');
        expect(names).toContain('serve');
        expect(names).toContain('attach');
        expect(names).toContain('acp');
        expect(names).not.toContain('explain');
        expect(names).not.toContain('github');
        expect(result.report).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'cli-core-shell', status: 'loaded', source: 'built-in' }),
            expect.objectContaining({ name: 'cli-workflows', status: 'disabled', source: 'built-in' }),
            expect.objectContaining({ name: 'cli-integrations', status: 'disabled', source: 'built-in' }),
            expect.objectContaining({ name: 'cli-remote', status: 'loaded', source: 'built-in' }),
            expect.objectContaining({ name: 'cli-extras', status: 'disabled', source: 'built-in' }),
        ]));
    });

    it('loads integration and remote commands when their plugins are explicitly enabled', async () => {
        const result = await discoverCommandRegistrations({
            productVersion: '0.1.0',
            pluginConfig: {
                enabled: ['cli-core-shell', 'cli-integrations', 'cli-remote', 'cli-extras'],
                paths: [],
            },
        });

        const names = result.map((registration) => registration.name);

        expect(names).toContain('lsp');
        expect(names).toContain('mcp');
        expect(names).toContain('rollbacks');
        expect(names).toContain('serve');
        expect(names).toContain('attach');
        expect(names).toContain('acp');
        expect(names).toContain('explain');
        expect(names).toContain('github');
    });
});
