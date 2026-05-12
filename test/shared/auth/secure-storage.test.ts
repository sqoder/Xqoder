import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
    EncryptedFileStorage,
    InMemorySecureStorage,
} from '../../../src/shared/auth/secure-storage.js';

let tempDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-p21a-storage-'));
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('EncryptedFileStorage (P21a)', () => {
    it('round-trips a value through encrypt + decrypt', async () => {
        const storage = new EncryptedFileStorage({ directory: tempDir });
        await storage.set('anthropic', 'secret-value');
        expect(await storage.get('anthropic')).toBe('secret-value');
    });

    it('creates a master.key file with 0600 permissions', async () => {
        const storage = new EncryptedFileStorage({ directory: tempDir });
        await storage.set('p', 'v');
        const stat = fs.statSync(path.join(tempDir, 'master.key'));
        expect(stat.size).toBe(32);
        expect(stat.mode & 0o777).toBe(0o600);
    });

    it('reuses an existing master.key across instances', async () => {
        const a = new EncryptedFileStorage({ directory: tempDir });
        await a.set('p', 'v');
        const b = new EncryptedFileStorage({ directory: tempDir });
        expect(await b.get('p')).toBe('v');
    });

    it('returns null for missing keys', async () => {
        const storage = new EncryptedFileStorage({ directory: tempDir });
        expect(await storage.get('missing')).toBeNull();
    });

    it('deletes credential files', async () => {
        const storage = new EncryptedFileStorage({ directory: tempDir });
        await storage.set('p', 'v');
        await storage.delete('p');
        expect(await storage.get('p')).toBeNull();
    });

    it('rejects credential files corrupted below minimum size', async () => {
        const storage = new EncryptedFileStorage({ directory: tempDir });
        await storage.set('p', 'v');
        fs.writeFileSync(path.join(tempDir, 'p.enc'), Buffer.alloc(10));
        await expect(storage.get('p')).rejects.toThrow(/corrupt/);
    });

    it('sanitizes provider names that contain filesystem-unfriendly chars', async () => {
        const storage = new EncryptedFileStorage({ directory: tempDir });
        await storage.set('anthropic/console', 'v');
        const files = fs.readdirSync(tempDir).filter((n) => n.endsWith('.enc'));
        expect(files).toEqual(['anthropic_console.enc']);
        expect(await storage.get('anthropic/console')).toBe('v');
    });

    it('lists only .enc entries', async () => {
        const storage = new EncryptedFileStorage({ directory: tempDir });
        await storage.set('anthropic', 'v');
        await storage.set('codex', 'v');
        const list = await storage.list();
        expect(list.sort()).toEqual(['anthropic', 'codex']);
    });

    it('rejects an existing master.key of wrong length', async () => {
        const masterKeyPath = path.join(tempDir, 'master.key');
        fs.writeFileSync(masterKeyPath, Buffer.alloc(16));
        const storage = new EncryptedFileStorage({ directory: tempDir, masterKeyPath });
        await expect(storage.set('p', 'v')).rejects.toThrow(/master key/);
    });
});

describe('InMemorySecureStorage (P21a)', () => {
    it('round-trips and lists', async () => {
        const storage = new InMemorySecureStorage();
        await storage.set('a', '1');
        await storage.set('b', '2');
        expect(await storage.get('a')).toBe('1');
        expect((await storage.list()).sort()).toEqual(['a', 'b']);
        await storage.delete('a');
        expect(await storage.get('a')).toBeNull();
    });
});
