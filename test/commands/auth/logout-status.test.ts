import { describe, expect, it } from 'bun:test';
import { InMemorySecureStorage, CredentialsManager } from '../../../src/shared/auth/index.js';
import { runLogout, runStatus } from '../../../src/commands/auth/logout.js';

function makeManager(): CredentialsManager {
    return new CredentialsManager({
        storage: new InMemorySecureStorage(),
        refresh: async (_p, t) => t,
    });
}

describe('runLogout (P21c)', () => {
    it('removes stored credentials', async () => {
        const credentialsManager = makeManager();
        await credentialsManager.save('anthropic', { accessToken: 'A' });
        const writes: string[] = [];
        const result = await runLogout('anthropic', {
            credentialsManager,
            writeOutput: (line) => writes.push(line),
        });
        expect(result.removed).toBe(true);
        expect(await credentialsManager.load('anthropic')).toBeNull();
        expect(writes.some((line) => line.includes('logout ok'))).toBe(true);
    });

    it('reports no-op when provider is not logged in', async () => {
        const credentialsManager = makeManager();
        const writes: string[] = [];
        const result = await runLogout('anthropic', {
            credentialsManager,
            writeOutput: (line) => writes.push(line),
        });
        expect(result.removed).toBe(false);
        expect(writes.some((line) => line.includes('no credentials'))).toBe(true);
    });
});

describe('runStatus (P21c)', () => {
    it('reports no providers when empty', async () => {
        const credentialsManager = makeManager();
        const writes: string[] = [];
        const report = await runStatus({
            credentialsManager,
            writeOutput: (line) => writes.push(line),
        });
        expect(report).toEqual([]);
        expect(writes).toEqual(['no providers logged in']);
    });

    it('lists providers with expiry when present', async () => {
        const credentialsManager = makeManager();
        const expiresAt = Date.UTC(2030, 0, 1);
        await credentialsManager.save('anthropic', { accessToken: 'A', expiresAt });
        await credentialsManager.save('codex', { accessToken: 'B' });
        const writes: string[] = [];
        const report = await runStatus({
            credentialsManager,
            writeOutput: (line) => writes.push(line),
        });
        expect(report).toEqual([
            { provider: 'anthropic', expiresAt },
            { provider: 'codex' },
        ]);
        expect(writes.some((line) => line.startsWith('anthropic: logged in (expires'))).toBe(true);
        expect(writes.some((line) => line === 'codex: logged in')).toBe(true);
    });
});
