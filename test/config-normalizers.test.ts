import { describe, expect, it } from 'bun:test';
import {
    mergeXQoderConfig,
    normalizeXQoderConfig,
} from '../src/infra/shared/config-normalizers.js';

describe('config normalizer helpers', () => {
    it('merges nested config fragments without mutating the base config', () => {
        const base = normalizeXQoderConfig({
            providers: {
                openai: {
                    apiKey: 'base-key',
                    defaultModel: 'gpt-4o-mini',
                },
            },
            permissions: {
                defaultMode: 'allow',
                tools: {
                    read: 'allow',
                },
            },
            hooks: {
                PreToolUse: [
                    {
                        hooks: [
                            { type: 'command', command: 'echo base' },
                        ],
                    },
                ],
            },
            plugins: {
                enabled: ['base-plugin'],
            },
        });

        const merged = mergeXQoderConfig(base, {
            providers: {
                openai: {
                    baseUrl: 'https://example.test/v1',
                },
            },
            permissions: {
                tools: {
                    write: 'deny',
                },
            },
            hooks: {
                PreToolUse: [
                    {
                        hooks: [
                            { type: 'command', command: 'echo override' },
                        ],
                    },
                ],
            },
            plugins: {
                enabled: ['override-plugin'],
                disabled: ['legacy-plugin'],
            },
        });

        expect(base.providers.openai?.baseUrl).toBeUndefined();
        expect(base.permissions.tools?.write).toBeUndefined();
        expect(base.hooks.PreToolUse).toHaveLength(1);
        expect(base.plugins.enabled).toEqual(['base-plugin']);

        expect(merged.providers.openai?.apiKey).toBe('base-key');
        expect(merged.providers.openai?.baseUrl).toBe('https://example.test/v1');
        expect(merged.permissions.tools?.read).toBe('allow');
        expect(merged.permissions.tools?.write).toBe('deny');
        expect(merged.hooks.PreToolUse).toHaveLength(2);
        expect(merged.plugins.enabled).toEqual(['override-plugin']);
        expect(merged.plugins.disabled).toEqual(['legacy-plugin']);
    });

    it('omits undefined optional config fields during normalization', () => {
        const normalized = normalizeXQoderConfig({
            hooks: {
                PreToolUse: [
                    {
                        hooks: [
                            { type: 'command', command: 'echo hi' },
                        ],
                    },
                ],
            },
            providers: {
                openai: {
                    apiKey: 'base-key',
                },
            },
            smallModel: {
                model: 'gpt-4o-mini',
            },
        });

        expect('theme' in normalized).toBe(false);
        expect('baseUrl' in normalized.providers.openai!).toBe(false);
        expect('provider' in normalized.smallModel!).toBe(false);
        expect('matcher' in normalized.hooks.PreToolUse![0]!).toBe(false);
        expect('shell' in normalized.hooks.PreToolUse![0]!.hooks[0]!).toBe(false);
        expect('timeout' in normalized.hooks.PreToolUse![0]!.hooks[0]!).toBe(false);
    });
});
