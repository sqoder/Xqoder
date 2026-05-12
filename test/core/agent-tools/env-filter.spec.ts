import { describe, expect, it } from 'bun:test';
import { filterSensitiveEnv } from '../../../src/core/agent/tools/env-filter.js';

describe('filterSensitiveEnv', () => {
    it('strips ANTHROPIC_API_KEY from parent env', () => {
        const filtered = filterSensitiveEnv(
            {
                ANTHROPIC_API_KEY: 'sk-abc',
                PATH: '/usr/bin',
            },
            undefined,
        );
        expect(filtered).not.toHaveProperty('ANTHROPIC_API_KEY');
        expect(filtered['PATH']).toBe('/usr/bin');
    });

    it('strips GITHUB_TOKEN, OPENAI_API_KEY, AWS_SECRET_ACCESS_KEY', () => {
        const filtered = filterSensitiveEnv(
            {
                GITHUB_TOKEN: 'ghp_x',
                OPENAI_API_KEY: 'sk-o',
                AWS_SECRET_ACCESS_KEY: 'secret',
                AWS_SESSION_TOKEN: 'sess',
                USER_PASSWORD: 'pw',
                NPM_CONFIG_AUTH_COOKIE: 'c',
                MY_CREDENTIAL_STORE: 'v',
            },
            undefined,
        );
        expect(Object.keys(filtered)).toEqual([]);
    });

    it('preserves non-sensitive parent env like PATH, HOME, LANG', () => {
        const filtered = filterSensitiveEnv(
            {
                PATH: '/usr/bin',
                HOME: '/home/u',
                LANG: 'en_US.UTF-8',
                TERM: 'xterm',
            },
            undefined,
        );
        expect(filtered).toEqual({
            PATH: '/usr/bin',
            HOME: '/home/u',
            LANG: 'en_US.UTF-8',
            TERM: 'xterm',
        });
    });

    it('allows explicit opt-in of sensitive key via config.env', () => {
        const filtered = filterSensitiveEnv(
            {
                ANTHROPIC_API_KEY: 'leaked-from-parent',
                PATH: '/usr/bin',
            },
            {
                GITHUB_TOKEN: 'explicitly-provided',
            },
        );
        expect(filtered).not.toHaveProperty('ANTHROPIC_API_KEY');
        expect(filtered['GITHUB_TOKEN']).toBe('explicitly-provided');
        expect(filtered['PATH']).toBe('/usr/bin');
    });

    it('explicit env overrides non-sensitive parent values', () => {
        const filtered = filterSensitiveEnv(
            { PATH: '/usr/bin' },
            { PATH: '/custom/bin' },
        );
        expect(filtered['PATH']).toBe('/custom/bin');
    });

    it('handles undefined explicit env', () => {
        const filtered = filterSensitiveEnv({ PATH: '/bin' }, undefined);
        expect(filtered).toEqual({ PATH: '/bin' });
    });

    it('skips parent env values that are undefined', () => {
        const filtered = filterSensitiveEnv(
            { PATH: '/bin', UNSET: undefined as unknown as string },
            undefined,
        );
        expect(filtered).toEqual({ PATH: '/bin' });
    });
});
