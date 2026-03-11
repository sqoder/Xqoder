import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { runListPluginsCommand } from './plugins.js';

describe('plugins command', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    afterEach(() => {
        consoleLog.mockClear();
    });

    afterAll(() => {
        consoleLog.mockRestore();
    });

    it('prints plugin load status in text mode', async () => {
        await runListPluginsCommand({}, {
            configManager: {
                load: () => ({ plugins: { enabled: [], disabled: [], paths: [], allowIncompatible: false } } as never),
            },
            discover: async () => ({
                commands: [],
                report: [
                    { name: 'cli-core-shell', status: 'loaded', source: 'built-in', version: '0.1.0' },
                    { name: 'future-plugin', status: 'incompatible', source: 'external', reason: 'version mismatch' },
                ],
            }),
        });

        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('cli-core-shell status=loaded source=built-in version=0.1.0'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('future-plugin status=incompatible source=external reason=version mismatch'));
    });

    it('prints plugin load status as JSON', async () => {
        await runListPluginsCommand({ json: true }, {
            configManager: {
                load: () => ({ plugins: { enabled: [], disabled: [], paths: [], allowIncompatible: false } } as never),
            },
            discover: async () => ({
                commands: [],
                report: [
                    { name: 'cli-core-shell', status: 'loaded', source: 'built-in', version: '0.1.0' },
                ],
            }),
        });

        const payload = consoleLog.mock.calls.at(-1)?.[0] as string;
        expect(JSON.parse(payload)).toMatchObject({
            report: [{ name: 'cli-core-shell', status: 'loaded' }],
        });
    });
});
