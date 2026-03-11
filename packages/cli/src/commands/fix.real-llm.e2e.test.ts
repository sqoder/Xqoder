import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runFixCommand } from './fix.js';
import {
    cleanupTempProjects,
    createIntegrationRuntime,
    createRealLlmE2EConfig,
    createTempProjectFromFixture,
    getRealLlmE2ESettings,
    type FixFixtureName,
} from './fix.e2e-utils.js';

const settings = getRealLlmE2ESettings();
const realLlmIt = settings.enabled ? it : it.skip;
const defaultFixtures: FixFixtureName[] = ['syntax-error'];
const fixtures = settings.fixtures.length > 0 ? settings.fixtures : defaultFixtures;

afterEach(() => {
    cleanupTempProjects();
});

describe('xqoder fix real LLM E2E', () => {
    for (const fixture of fixtures) {
        realLlmIt(`repairs ${fixture} with the configured LLM`, async () => {
            const projectDir = createTempProjectFromFixture(fixture);

            await runFixCommand({
                dir: projectDir,
                model: settings.llmConfig?.model ?? 'gpt-4o',
                maxAttempts: settings.maxAttempts,
            }, {
                configManager: {
                    load: () => createRealLlmE2EConfig(settings),
                },
                runtimeFactory: () => createIntegrationRuntime(),
            });

            assertFixtureRepaired(fixture, projectDir);
        }, 120000);
    }
});

function assertFixtureRepaired(fixture: FixFixtureName, projectDir: string): void {
    switch (fixture) {
        case 'syntax-error': {
            const server = fs.readFileSync(path.join(projectDir, 'server.js'), 'utf-8');
            expect(server).toContain('Local: http://localhost:');
            expect(server).toContain("console.log('boot broken');");
            break;
        }
        case 'missing-local-module': {
            const messageFile = path.join(projectDir, 'message.js');
            expect(fs.existsSync(messageFile)).toBe(true);
            expect(fs.readFileSync(messageFile, 'utf-8')).toContain('getMessage');
            break;
        }
        case 'missing-script': {
            const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8')) as {
                scripts?: Record<string, string>;
            };
            expect(packageJson.scripts?.['dev']).toContain('server.js');
            break;
        }
        case 'port-conflict': {
            const server = fs.readFileSync(path.join(projectDir, 'server.js'), 'utf-8');
            expect(server).toContain('Local: http://localhost:');
            break;
        }
        case 'next-missing-env': {
            const server = fs.readFileSync(path.join(projectDir, 'server.js'), 'utf-8');
            expect(server).toContain('API_BASE_URL');
            expect(server).toContain('Local: http://localhost:');
            break;
        }
        case 'vite-typescript-error': {
            const source = fs.readFileSync(path.join(projectDir, 'src', 'main.ts'), 'utf-8');
            expect(source).not.toContain('"oops"');
            break;
        }
    }
}
