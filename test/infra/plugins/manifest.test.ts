// P18 — xqoder.plugin.json manifest parsing + validation.

import { describe, expect, it } from 'bun:test';
import {
    parsePluginManifest,
    type PluginManifestParseError,
} from '../../../src/infra/plugins/manifest.js';

describe('parsePluginManifest', () => {
    it('accepts a minimal manifest with only name + version', () => {
        const result = parsePluginManifest({ name: 'my-plugin', version: '0.1.0' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.manifest.name).toBe('my-plugin');
        expect(result.manifest.version).toBe('0.1.0');
        expect(result.manifest.provides).toBeUndefined();
    });

    it('preserves provides.commands/tools/skills/hooks verbatim', () => {
        const input = {
            name: 'rich',
            version: '1.2.3',
            entry: './index.js',
            provides: {
                commands: [{ name: '/hello', file: './cmd.js' }],
                tools: [{ name: 'hello_tool', file: './tool.js' }],
                skills: [{ file: './skill.md' }, { dir: './skills' }],
                hooks: {
                    PreToolUse: [{ command: './hook.sh' }],
                },
            },
        };
        const result = parsePluginManifest(input);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.manifest.entry).toBe('./index.js');
        expect(result.manifest.provides?.commands).toEqual([{ name: '/hello', file: './cmd.js' }]);
        expect(result.manifest.provides?.tools).toEqual([{ name: 'hello_tool', file: './tool.js' }]);
        expect(result.manifest.provides?.skills).toEqual([{ file: './skill.md' }, { dir: './skills' }]);
        expect(result.manifest.provides?.hooks?.PreToolUse).toEqual([{ command: './hook.sh' }]);
    });

    it('rejects non-object input', () => {
        const result = parsePluginManifest('nope');
        expect(result.ok).toBe(false);
        expectError(result, /must be an object/i);
    });

    it('rejects missing or empty name', () => {
        expectError(parsePluginManifest({ version: '0.1.0' }), /name/i);
        expectError(parsePluginManifest({ name: '', version: '0.1.0' }), /name/i);
        expectError(parsePluginManifest({ name: 123, version: '0.1.0' }), /name/i);
    });

    it('rejects missing or non-string version', () => {
        expectError(parsePluginManifest({ name: 'x' }), /version/i);
        expectError(parsePluginManifest({ name: 'x', version: 1 }), /version/i);
    });

    it('rejects unknown hook event names', () => {
        const bad = parsePluginManifest({
            name: 'x',
            version: '0.1.0',
            provides: {
                hooks: {
                    NotARealEvent: [{ command: './hook.sh' }],
                },
            },
        });
        expectError(bad, /hook event/i);
    });

    it('rejects command entries missing name or file', () => {
        expectError(
            parsePluginManifest({
                name: 'x',
                version: '0.1.0',
                provides: { commands: [{ name: '/hi' }] },
            }),
            /command/i,
        );
    });

    it('rejects tool entries missing name or file', () => {
        expectError(
            parsePluginManifest({
                name: 'x',
                version: '0.1.0',
                provides: { tools: [{ file: './t.js' }] },
            }),
            /tool/i,
        );
    });

    it('requires at least one of file or dir for skill entries', () => {
        expectError(
            parsePluginManifest({
                name: 'x',
                version: '0.1.0',
                provides: { skills: [{}] },
            }),
            /skill/i,
        );
    });
});

function expectError(
    result: { ok: true } | { ok: false; errors: PluginManifestParseError[] },
    matcher: RegExp,
): void {
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    const joined = result.errors.map((e) => e.message).join('\n');
    expect(joined).toMatch(matcher);
}
