import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { ConfigManager } from '@xqoder/shared';
import {
    createConfigDoctorReport,
} from '../../../src/application/config/service.js';
import { MISSING_API_KEY_GUIDANCE } from '../../../src/application/config/api-key-guidance.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('config doctor report', () => {
    it('surfaces the current auth/model guidance when the api key is missing', async () => {
        const manager = createManager();

        const report = await createConfigDoctorReport(manager, {
            cwd: createTempDir(),
            hasExecutable: () => true,
            discoverPlugins: async () => ({ commands: [], report: [] }),
        });

        const apiKeyCheck = report.checks.find((check) => check.name === 'LLM API key');

        expect(report.ok).toBe(false);
        expect(apiKeyCheck).toMatchObject({
            status: 'error',
            message: MISSING_API_KEY_GUIDANCE,
        });
    });

    it('marks the api key check as configured when XQODER_LLM_API_KEY is provided', async () => {
        const manager = createManager();

        const report = await createConfigDoctorReport(manager, {
            cwd: createTempDir(),
            env: {
                ...process.env,
                XQODER_LLM_API_KEY: 'env-key',
            },
            hasExecutable: () => true,
            discoverPlugins: async () => ({ commands: [], report: [] }),
        });

        const apiKeyCheck = report.checks.find((check) => check.name === 'LLM API key');

        expect(report.ok).toBe(true);
        expect(report.appliedEnvVars).toContain('XQODER_LLM_API_KEY');
        expect(apiKeyCheck).toMatchObject({
            status: 'ok',
            message: 'Configured (env)',
        });
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-config-doctor-'));
    tempDirs.push(dir);
    return dir;
}
