// P10 feature-flag unit tests.
// Covers default resolution, env overrides (1/0/true/false), file overrides
// (via XQODER_FEATURES_PATH), cache invalidation via enableConfigs, and the
// describeFeatures origin report. No network, no actual ~/.xqoder access.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    FEATURE_DEFAULTS,
    clearFeatureOverride,
    describeFeatures,
    enableConfigs,
    feature,
    resetFeatureCache,
    writeFeatureOverride,
} from '../../src/shared/feature-flags.js';

let tmpHome = '';
let savedFeaturesPath: string | undefined;
const ENV_KEYS_TO_RESTORE: string[] = [];

function setEnv(key: string, value: string | undefined): void {
    if (!ENV_KEYS_TO_RESTORE.includes(key)) {
        ENV_KEYS_TO_RESTORE.push(key);
    }
    if (value === undefined) {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }
}

beforeEach(() => {
    savedFeaturesPath = process.env.XQODER_FEATURES_PATH;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-features-'));
    process.env.XQODER_FEATURES_PATH = path.join(tmpHome, '.xqoder', 'features.json');
    resetFeatureCache();
});

afterEach(() => {
    for (const key of ENV_KEYS_TO_RESTORE) {
        delete process.env[key];
    }
    ENV_KEYS_TO_RESTORE.length = 0;

    if (savedFeaturesPath === undefined) {
        delete process.env.XQODER_FEATURES_PATH;
    } else {
        process.env.XQODER_FEATURES_PATH = savedFeaturesPath;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
    resetFeatureCache();
});

describe('feature() default resolution', () => {
    it('returns FEATURE_DEFAULTS value for a known name', () => {
        expect(feature('DUMP_SYSTEM_PROMPT')).toBe(true);
        expect(feature('DAEMON')).toBe(false);
        expect(feature('TOKEN_BUDGET_ACTIVE')).toBe(false);
    });

    it('returns false for unknown flags (no throw)', () => {
        expect(feature('NOT_A_REAL_FLAG')).toBe(false);
    });
});

describe('feature() env override', () => {
    it('XQODER_FEATURE_<name>=1 forces true even if default is false', () => {
        setEnv('XQODER_FEATURE_DAEMON', '1');
        expect(feature('DAEMON')).toBe(true);
    });

    it('XQODER_FEATURE_<name>=0 forces false even if default is true', () => {
        setEnv('XQODER_FEATURE_DUMP_SYSTEM_PROMPT', '0');
        expect(feature('DUMP_SYSTEM_PROMPT')).toBe(false);
    });

    it('accepts true/false strings case-insensitively', () => {
        setEnv('XQODER_FEATURE_DAEMON', 'TRUE');
        expect(feature('DAEMON')).toBe(true);
        setEnv('XQODER_FEATURE_DAEMON', 'False');
        expect(feature('DAEMON')).toBe(false);
    });

    it('ignores garbage values and falls through to default', () => {
        setEnv('XQODER_FEATURE_DAEMON', 'maybe');
        expect(feature('DAEMON')).toBe(false);
    });

    it('env override beats file override', () => {
        writeFeatureOverride('DAEMON', true, tmpHome);
        enableConfigs(tmpHome);
        setEnv('XQODER_FEATURE_DAEMON', '0');
        expect(feature('DAEMON')).toBe(false);
    });
});

describe('feature() file override via ~/.xqoder/features.json', () => {
    it('reads a persisted override', () => {
        writeFeatureOverride('DAEMON', true, tmpHome);
        enableConfigs(tmpHome);
        expect(feature('DAEMON')).toBe(true);
    });

    it('enableConfigs reloads the cache', () => {
        writeFeatureOverride('DAEMON', true, tmpHome);
        enableConfigs(tmpHome);
        expect(feature('DAEMON')).toBe(true);
        writeFeatureOverride('DAEMON', false, tmpHome);
        enableConfigs(tmpHome);
        expect(feature('DAEMON')).toBe(false);
    });

    it('malformed JSON falls back to defaults', () => {
        const featuresPath = path.join(tmpHome, '.xqoder', 'features.json');
        fs.mkdirSync(path.dirname(featuresPath), { recursive: true });
        fs.writeFileSync(featuresPath, '{not valid json');
        enableConfigs(tmpHome);
        expect(feature('DAEMON')).toBe(false);
        expect(feature('DUMP_SYSTEM_PROMPT')).toBe(true);
    });

    it('JSON array content is ignored', () => {
        const featuresPath = path.join(tmpHome, '.xqoder', 'features.json');
        fs.mkdirSync(path.dirname(featuresPath), { recursive: true });
        fs.writeFileSync(featuresPath, '["DAEMON"]');
        enableConfigs(tmpHome);
        expect(feature('DAEMON')).toBe(false);
    });

    it('non-boolean entries are dropped', () => {
        const featuresPath = path.join(tmpHome, '.xqoder', 'features.json');
        fs.mkdirSync(path.dirname(featuresPath), { recursive: true });
        fs.writeFileSync(featuresPath, JSON.stringify({ DAEMON: 'yes', DUMP_SYSTEM_PROMPT: false }));
        enableConfigs(tmpHome);
        expect(feature('DAEMON')).toBe(false); // default
        expect(feature('DUMP_SYSTEM_PROMPT')).toBe(false); // overridden
    });
});

describe('writeFeatureOverride / clearFeatureOverride', () => {
    it('writeFeatureOverride persists and updates cache atomically', () => {
        const { featuresPath } = writeFeatureOverride('DAEMON', true, tmpHome);
        expect(fs.existsSync(featuresPath)).toBe(true);
        const content = JSON.parse(fs.readFileSync(featuresPath, 'utf-8')) as Record<string, boolean>;
        expect(content.DAEMON).toBe(true);
        expect(feature('DAEMON')).toBe(true);
    });

    it('clearFeatureOverride removes the key but keeps the file', () => {
        writeFeatureOverride('DAEMON', true, tmpHome);
        writeFeatureOverride('BG_SESSIONS', true, tmpHome);
        const { featuresPath } = clearFeatureOverride('DAEMON', tmpHome);
        const content = JSON.parse(fs.readFileSync(featuresPath, 'utf-8')) as Record<string, boolean>;
        expect(content.DAEMON).toBeUndefined();
        expect(content.BG_SESSIONS).toBe(true);
        expect(feature('DAEMON')).toBe(false);
        expect(feature('BG_SESSIONS')).toBe(true);
    });

    it('clearFeatureOverride is idempotent when the key is absent', () => {
        const result = clearFeatureOverride('DAEMON', tmpHome);
        expect(result.written.DAEMON).toBeUndefined();
    });
});

describe('describeFeatures', () => {
    it('reports origin = "default" for untouched flags', () => {
        const origins = describeFeatures(tmpHome);
        const daemon = origins.find((origin) => origin.name === 'DAEMON');
        expect(daemon).toBeDefined();
        expect(daemon!.source).toBe('default');
        expect(daemon!.enabled).toBe(FEATURE_DEFAULTS.DAEMON);
    });

    it('reports origin = "file" when overridden via features.json', () => {
        writeFeatureOverride('DAEMON', true, tmpHome);
        const origins = describeFeatures(tmpHome);
        const daemon = origins.find((origin) => origin.name === 'DAEMON');
        expect(daemon!.source).toBe('file');
        expect(daemon!.enabled).toBe(true);
    });

    it('reports origin = "env" when env var set (highest priority)', () => {
        writeFeatureOverride('DAEMON', true, tmpHome);
        setEnv('XQODER_FEATURE_DAEMON', '0');
        const origins = describeFeatures(tmpHome);
        const daemon = origins.find((origin) => origin.name === 'DAEMON');
        expect(daemon!.source).toBe('env');
        expect(daemon!.enabled).toBe(false);
    });

    it('merges unknown file keys into the output', () => {
        writeFeatureOverride('CUSTOM_FLAG', true, tmpHome);
        const origins = describeFeatures(tmpHome);
        const custom = origins.find((origin) => origin.name === 'CUSTOM_FLAG');
        expect(custom).toBeDefined();
        expect(custom!.source).toBe('file');
        expect(custom!.default).toBe(false);
        expect(custom!.enabled).toBe(true);
    });
});
