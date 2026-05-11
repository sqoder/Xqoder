// P18 — plugin loader (reads manifest, registers commands/tools/skills/hooks,
// returns unload handle).

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadExtendedPlugin, type PluginRegistries } from '../../../src/infra/plugins/loader.js';

function createPluginFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-plugin-'));
    fs.writeFileSync(
        path.join(root, 'xqoder.plugin.json'),
        JSON.stringify({
            name: 'fixture-plugin',
            version: '0.1.0',
            entry: './index.js',
            provides: {
                commands: [{ name: '/hello', file: './cmd.js' }],
                tools: [{ name: 'hello_tool', file: './tool.js' }],
                skills: [{ file: './skills/greet.md' }],
                hooks: {
                    PreToolUse: [{ command: './hook.sh' }],
                },
            },
        }),
    );

    fs.writeFileSync(
        path.join(root, 'index.js'),
        `export default { onActivate: async (ctx) => { ctx.__activated = true; }, onDeactivate: async (ctx) => { ctx.__deactivated = true; } };`,
    );
    fs.writeFileSync(
        path.join(root, 'cmd.js'),
        `export default { name: '/hello', run: () => 'hi' };`,
    );
    fs.writeFileSync(
        path.join(root, 'tool.js'),
        `export default class HelloTool {
            definition = { name: 'hello_tool', description: 'greets', parameters: {} };
            async execute() { return { toolCallId: 't1', success: true, output: 'hello' }; }
        };`,
    );
    fs.mkdirSync(path.join(root, 'skills'));
    fs.writeFileSync(
        path.join(root, 'skills', 'greet.md'),
        '---\nname: greet\ndescription: Greet the user warmly.\n---\n\nBody text.',
    );
    fs.writeFileSync(path.join(root, 'hook.sh'), '#!/bin/sh\necho ok\n');

    return root;
}

function createRegistries(): {
    registries: PluginRegistries;
    commands: Map<string, unknown>;
    tools: Map<string, unknown>;
    skills: Array<{ name: string; file: string }>;
    hooks: Array<{ event: string; command: string }>;
    ctx: Record<string, unknown>;
} {
    const commands = new Map<string, unknown>();
    const tools = new Map<string, unknown>();
    const skills: Array<{ name: string; file: string }> = [];
    const hooks: Array<{ event: string; command: string }> = [];
    const ctx: Record<string, unknown> = {};

    const registries: PluginRegistries = {
        commands: {
            register: (name, mod) => {
                commands.set(name, mod);
            },
            unregister: (name) => {
                commands.delete(name);
            },
        },
        tools: {
            register: (tool) => {
                const name = (tool as { definition?: { name?: string } }).definition?.name;
                if (name) tools.set(name, tool);
            },
            unregister: (name) => {
                tools.delete(name);
            },
        },
        skills: {
            register: (skill) => {
                skills.push({ name: skill.name, file: skill.filePath });
            },
            unregister: (name) => {
                const idx = skills.findIndex((s) => s.name === name);
                if (idx >= 0) skills.splice(idx, 1);
            },
        },
        hooks: {
            register: (event, handler) => {
                hooks.push({ event, command: handler.command ?? '' });
            },
            unregister: (event, handler) => {
                const idx = hooks.findIndex((h) => h.event === event && h.command === (handler.command ?? ''));
                if (idx >= 0) hooks.splice(idx, 1);
            },
        },
        ctx,
    };

    return { registries, commands, tools, skills, hooks, ctx };
}

describe('loadExtendedPlugin', () => {
    it('registers commands, tools, skills, and hooks from manifest', async () => {
        const dir = createPluginFixture();
        const { registries, commands, tools, skills, hooks, ctx } = createRegistries();

        const loaded = await loadExtendedPlugin(dir, registries);

        expect(loaded.manifest.name).toBe('fixture-plugin');
        expect(commands.has('/hello')).toBe(true);
        expect(tools.has('hello_tool')).toBe(true);
        expect(skills.map((s) => s.name)).toContain('greet');
        expect(hooks).toEqual([{ event: 'PreToolUse', command: './hook.sh' }]);
        expect(ctx.__activated).toBe(true);
    });

    it('unload reverses all registrations and fires onDeactivate', async () => {
        const dir = createPluginFixture();
        const { registries, commands, tools, skills, hooks, ctx } = createRegistries();

        const loaded = await loadExtendedPlugin(dir, registries);
        await loaded.unload();

        expect(commands.size).toBe(0);
        expect(tools.size).toBe(0);
        expect(skills.length).toBe(0);
        expect(hooks.length).toBe(0);
        expect(ctx.__deactivated).toBe(true);
    });

    it('surfaces a missing-manifest error with a helpful message', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-plugin-'));
        const { registries } = createRegistries();

        await expect(loadExtendedPlugin(dir, registries)).rejects.toThrow(/xqoder\.plugin\.json/);
    });

    it('supports skills.dir entries by scanning the directory', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-plugin-'));
        fs.writeFileSync(
            path.join(dir, 'xqoder.plugin.json'),
            JSON.stringify({
                name: 'dir-skills',
                version: '0.1.0',
                provides: {
                    skills: [{ dir: './bundled' }],
                },
            }),
        );
        fs.mkdirSync(path.join(dir, 'bundled'));
        fs.writeFileSync(
            path.join(dir, 'bundled', 'a.md'),
            '---\nname: a\ndescription: first.\n---\nA.',
        );
        fs.writeFileSync(
            path.join(dir, 'bundled', 'b.md'),
            '---\nname: b\ndescription: second.\n---\nB.',
        );

        const { registries, skills } = createRegistries();
        await loadExtendedPlugin(dir, registries);
        expect(skills.map((s) => s.name).sort()).toEqual(['a', 'b']);
    });
});
