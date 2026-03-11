import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeStatus } from '@xqoder/shared';
import { NodeRunner } from './node-runner.js';

const tempDirs: string[] = [];

function createTempProject(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-node-runner-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('NodeRunner', () => {
    it('treats a server as ready once the target port is bound even when no ready log is emitted', async () => {
        const projectDir = createTempProject();

        fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
            name: 'runtime-fixture',
            private: true,
        }, null, 2));
        fs.writeFileSync(path.join(projectDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
        fs.mkdirSync(path.join(projectDir, 'node_modules'), { recursive: true });

        const runner = new NodeRunner();
        (runner as any).portDetector = {
            findAvailablePort: async () => 43000,
            waitForPort: async () => true,
        };

        const state = await runner.start(
            projectDir,
            `node -e "setInterval(() => {}, 10000)"`,
            43000,
        );

        try {
            expect(state.status).toBe(RuntimeStatus.Running);
            expect(state.port).toBe(43000);
            expect(state.url).toBe('http://localhost:43000');
            expect(state.command).toBe(`node -e "setInterval(() => {}, 10000)"`);
            expect(state.packageManager).toBe('pnpm');
        } finally {
            await runner.stop();
        }
    }, 10000);
});
