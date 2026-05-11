import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createDefaultCredentialsManager } from '../../../src/application/config/credentials.js';
import { hydrateLLMConfigFromCredentials } from '../../../src/application/config/hydrate-credentials.js';
import { InMemorySecureStorage, CredentialsManager } from '../../../src/shared/auth/index.js';

let tempDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-p21c-'));
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('createDefaultCredentialsManager (P21c)', () => {
    it('uses ~/.xqoder/credentials + master.key when no storage is provided', async () => {
        const manager = createDefaultCredentialsManager({ homeDir: tempDir });
        await manager.save('anthropic', { accessToken: 'A' });
        expect(fs.existsSync(path.join(tempDir, '.xqoder', 'master.key'))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, '.xqoder', 'credentials', 'anthropic.enc'))).toBe(true);
    });

    it('persists and reloads tokens through EncryptedFileStorage', async () => {
        const a = createDefaultCredentialsManager({ homeDir: tempDir });
        await a.save('anthropic', { accessToken: 'A', refreshToken: 'R', expiresAt: Date.now() + 600_000 });
        const b = createDefaultCredentialsManager({ homeDir: tempDir });
        const loaded = await b.load('anthropic');
        expect(loaded?.accessToken).toBe('A');
    });
});

describe('hydrateLLMConfigFromCredentials (P21c)', () => {
    it('leaves config unchanged when apiKey is already set', async () => {
        const credentialsManager = new CredentialsManager({
            storage: new InMemorySecureStorage(),
            refresh: async (_p, t) => t,
        });
        await credentialsManager.save('anthropic', { accessToken: 'OAUTH' });
        const hydrated = await hydrateLLMConfigFromCredentials(
            { provider: 'anthropic', model: 'claude-3', apiKey: 'configured-key' },
            { credentialsManager },
        );
        expect(hydrated.apiKey).toBe('configured-key');
    });

    it('fills apiKey from credentials when config.apiKey is empty', async () => {
        const credentialsManager = new CredentialsManager({
            storage: new InMemorySecureStorage(),
            refresh: async (_p, t) => t,
        });
        await credentialsManager.save('anthropic', {
            accessToken: 'OAUTH-AT',
            expiresAt: Date.now() + 600_000,
        });
        const hydrated = await hydrateLLMConfigFromCredentials(
            { provider: 'anthropic', model: 'claude-3', apiKey: '' },
            { credentialsManager },
        );
        expect(hydrated.apiKey).toBe('OAUTH-AT');
    });

    it('returns unchanged when no credentials exist for the provider', async () => {
        const credentialsManager = new CredentialsManager({
            storage: new InMemorySecureStorage(),
            refresh: async (_p, t) => t,
        });
        const hydrated = await hydrateLLMConfigFromCredentials(
            { provider: 'anthropic', model: 'claude-3', apiKey: '' },
            { credentialsManager },
        );
        expect(hydrated.apiKey).toBe('');
    });

    it('calls ensureFreshTokens so near-expiry tokens are refreshed', async () => {
        const now = 1_700_000_000_000;
        let refreshes = 0;
        const credentialsManager = new CredentialsManager({
            storage: new InMemorySecureStorage(),
            now: () => now,
            refresh: async (_p, _t) => {
                refreshes += 1;
                return { accessToken: 'REFRESHED', refreshToken: 'R', expiresAt: now + 3600 * 1000 };
            },
        });
        await credentialsManager.save('anthropic', {
            accessToken: 'OLD',
            refreshToken: 'R',
            expiresAt: now + 60_000,
        });
        const hydrated = await hydrateLLMConfigFromCredentials(
            { provider: 'anthropic', model: 'claude-3', apiKey: '' },
            { credentialsManager },
        );
        expect(hydrated.apiKey).toBe('REFRESHED');
        expect(refreshes).toBe(1);
    });
});
