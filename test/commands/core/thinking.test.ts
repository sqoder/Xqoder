import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ConfigManager } from '@xqoder/shared';
import {
    runEffortSet,
    runFastToggle,
    runThinkSet,
    runThinkingStatus,
} from '../../../src/commands/core/thinking.js';
import {
    __resetFastModeCooldownForTests,
    triggerFastModeCooldown,
} from '../../../src/shared/thinking/index.js';

let tempDir: string;
let configPath: string;
let manager: ConfigManager;
const writes: string[] = [];

const writeOutput = (line: string): void => {
    writes.push(line);
};

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-p20b-cli-'));
    configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(
        configPath,
        JSON.stringify({ llm: { provider: 'openai', model: 'gpt-4o', apiKey: 'k' } }, null, 2),
    );
    manager = new ConfigManager({ configPath });
    writes.length = 0;
    __resetFastModeCooldownForTests();
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    __resetFastModeCooldownForTests();
});

describe('runThinkSet (P20b)', () => {
    it('writes mode=enabled when "on"', () => {
        const result = runThinkSet('on', { manager, writeOutput });
        expect(result.mode).toBe('enabled');
        const persisted = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(persisted.thinking.mode).toBe('enabled');
    });

    it('writes mode=disabled when "off"', () => {
        const result = runThinkSet('off', { manager, writeOutput });
        expect(result.mode).toBe('disabled');
        const persisted = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(persisted.thinking.mode).toBe('disabled');
    });
});

describe('runEffortSet (P20b)', () => {
    it('normalizes canonical effort levels', () => {
        const result = runEffortSet('high', { manager, writeOutput });
        expect(result.effort).toBe('high');
        const persisted = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(persisted.thinking.effort).toBe('high');
    });

    it('normalizes aliases', () => {
        const result = runEffortSet('mid', { manager, writeOutput });
        expect(result.effort).toBe('medium');
    });

    it('throws on invalid value', () => {
        expect(() => runEffortSet('nonsense', { manager, writeOutput })).toThrow(/invalid effort/);
    });

    it('preserves unrelated thinking fields', () => {
        runThinkSet('on', { manager, writeOutput });
        runEffortSet('xhigh', { manager, writeOutput });
        const persisted = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(persisted.thinking.mode).toBe('enabled');
        expect(persisted.thinking.effort).toBe('xhigh');
    });
});

describe('runFastToggle (P20b)', () => {
    it('toggles fast mode from unset → fast', () => {
        const result = runFastToggle({ manager, writeOutput });
        expect(result.fastMode).toBe('fast');
        expect(writes.some((line) => line.includes('fast mode: on'))).toBe(true);
    });

    it('toggles fast → standard', () => {
        runFastToggle({ manager, writeOutput });
        const second = runFastToggle({ manager, writeOutput });
        expect(second.fastMode).toBe('standard');
    });

    it('warns when cooling down while toggling to fast', () => {
        triggerFastModeCooldown(60_000);
        const result = runFastToggle({ manager, writeOutput });
        expect(result.fastMode).toBe('fast');
        expect(writes.some((line) => line.includes('cooling down'))).toBe(true);
    });
});

describe('runThinkingStatus (P20b)', () => {
    it('reports defaults when no thinking config has been set', () => {
        const status = runThinkingStatus({ manager, writeOutput });
        expect(status.mode).toBe('disabled');
        expect(status.effort).toBe('unset');
        expect(status.fastMode).toBe('standard');
    });

    it('reports persisted settings', () => {
        runThinkSet('on', { manager, writeOutput });
        runEffortSet('high', { manager, writeOutput });
        writes.length = 0;
        const status = runThinkingStatus({ manager, writeOutput });
        expect(status.mode).toBe('enabled');
        expect(status.effort).toBe('high');
        expect(writes.some((line) => line.includes('thinking: enabled'))).toBe(true);
        expect(writes.some((line) => line.includes('effort: high'))).toBe(true);
    });
});
