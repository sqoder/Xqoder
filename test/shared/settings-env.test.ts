import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
    applySettingsEnv,
    loadSettingsEnvFromFile,
} from '../../src/shared/settings-env.js';

const tempDirs: string[] = [];
const savedEnvKeys: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    for (const key of savedEnvKeys) {
        delete process.env[key];
    }
    savedEnvKeys.length = 0;
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-env-'));
    tempDirs.push(dir);
    return dir;
}

function trackEnvKey(key: string): void {
    savedEnvKeys.push(key);
}

describe('settings env loader', () => {
    it('loads env map from ~/.xqoder/config.json', () => {
        const home = createTempDir();
        fs.mkdirSync(path.join(home, '.xqoder'), { recursive: true });
        fs.writeFileSync(
            path.join(home, '.xqoder', 'config.json'),
            JSON.stringify({ env: { FOO: 'bar', BAZ: '42' } }, null, 2),
        );
        const env = loadSettingsEnvFromFile(home);
        expect(env).toEqual({ FOO: 'bar', BAZ: '42' });
    });

    it('returns empty map when file is missing or malformed', () => {
        const home = createTempDir();
        expect(loadSettingsEnvFromFile(home)).toEqual({});

        fs.mkdirSync(path.join(home, '.xqoder'), { recursive: true });
        fs.writeFileSync(path.join(home, '.xqoder', 'config.json'), '{ not json ');
        expect(loadSettingsEnvFromFile(home)).toEqual({});
    });

    it('ignores non-string values in env map', () => {
        const home = createTempDir();
        fs.mkdirSync(path.join(home, '.xqoder'), { recursive: true });
        fs.writeFileSync(
            path.join(home, '.xqoder', 'config.json'),
            JSON.stringify({ env: { GOOD: 'ok', BAD: 1, ARR: ['x'] } }),
        );
        expect(loadSettingsEnvFromFile(home)).toEqual({ GOOD: 'ok' });
    });

    it('applies env map to process.env without overriding existing keys', () => {
        trackEnvKey('SETTINGS_ENV_NEW_KEY');
        trackEnvKey('SETTINGS_ENV_EXISTING_KEY');
        process.env.SETTINGS_ENV_EXISTING_KEY = 'preserved';
        applySettingsEnv({
            SETTINGS_ENV_NEW_KEY: 'applied',
            SETTINGS_ENV_EXISTING_KEY: 'would-overwrite',
        });
        expect(process.env.SETTINGS_ENV_NEW_KEY).toBe('applied');
        expect(process.env.SETTINGS_ENV_EXISTING_KEY).toBe('preserved');
    });

    it('supports XQODER_SETTINGS_PATH redirection', () => {
        const home = createTempDir();
        const custom = path.join(home, 'custom.json');
        fs.writeFileSync(custom, JSON.stringify({ env: { ALT: 'yes' } }));
        const prev = process.env.XQODER_SETTINGS_PATH;
        process.env.XQODER_SETTINGS_PATH = custom;
        try {
            expect(loadSettingsEnvFromFile(home)).toEqual({ ALT: 'yes' });
        } finally {
            if (prev === undefined) {
                delete process.env.XQODER_SETTINGS_PATH;
            } else {
                process.env.XQODER_SETTINGS_PATH = prev;
            }
        }
    });
});
