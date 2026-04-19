import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { ConfigManager } from '@xqoder/shared';
import {
    applyConfigInit,
    runConfigDoctor,
    runConfigInit,
    runConfigShow,
} from '../../../src/application/config/service.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('config service commands', () => {
    it('applies init settings into the layered config shape', () => {
        const manager = createManager();
        const current = manager.load({ mode: 'single' });

        const next = applyConfigInit(current, {
            provider: 'anthropic',
            model: 'claude-sonnet-4',
            smallModel: 'gpt-4.1-mini',
            smallProvider: 'openai',
            defaultAgent: 'coder',
            instruction: ['reply in Chinese'],
            sandboxMode: 'paths',
            allowPath: ['./docs'],
            vercelScope: 'demo-team',
        });

        expect(next.defaultAgent).toBe('coder');
        expect(next.providers.anthropic?.defaultModel).toBe('claude-sonnet-4');
        expect(next.smallModel).toEqual({
            provider: 'openai',
            model: 'gpt-4.1-mini',
        });
        expect(next.instructions).toEqual(['reply in Chinese']);
        expect(next.sandbox?.mode).toBe('paths');
        expect(next.sandbox?.allowedPaths).toEqual([path.resolve('./docs')]);
        expect(next.vercel?.scope).toBe('demo-team');
    });

    it('writes initialized config, show output, and doctor output through the public helpers', async () => {
        const manager = createManager();
        const showOutput: string[] = [];
        const doctorOutput: string[] = [];

        runConfigInit(manager, {
            provider: 'openai',
            model: 'gpt-4.1',
            apiKey: 'plain-key',
            defaultAgent: 'coder',
        });

        const saved = JSON.parse(fs.readFileSync(manager.getConfigPath(), 'utf-8'));
        expect(saved.defaultAgent).toBe('coder');
        expect(saved.providers.openai.defaultModel).toBe('gpt-4.1');

        runConfigShow(manager, { json: true }, {
            cwd: createTempDir(),
            writeOutput: (output) => showOutput.push(output),
        });
        await runConfigDoctor(manager, { json: true }, {
            cwd: createTempDir(),
            hasExecutable: () => true,
            writeOutput: (output) => doctorOutput.push(output),
            discoverPlugins: async () => ({ commands: [], report: [] }),
        });

        expect(JSON.parse(showOutput[0] ?? '{}').config.providers.openai.apiKey).toContain('plai***');
        expect(JSON.parse(doctorOutput[0] ?? '{}').checks.some((check: { name: string }) => check.name === 'LLM API key'))
            .toBe(true);
    });
});

function createManager(): ConfigManager {
    const homeDir = createTempDir();
    const configPath = path.join(homeDir, '.xqoder', 'config.json');
    const manager = new ConfigManager({ configPath, homeDir });
    manager.load({ mode: 'single' });
    return manager;
}

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-config-service-'));
    tempDirs.push(dir);
    return dir;
}
