// P21a — Secure storage abstraction with AES-256-GCM encrypted-file fallback.
//
// On first call the fallback reads or creates ~/.xqoder/master.key (mode 0600)
// containing a 32-byte random key. Each credential is encrypted separately:
//   file layout: iv(12) || authTag(16) || ciphertext
//   file name:   <provider>.enc (mode 0600)
//
// Production builds should prefer the OS keychain (macOS Keychain, libsecret,
// DPAPI); those backends live in P21b as optional dependencies. The fallback
// is always available and is what we test against here.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SecureStorage } from './types.js';

const MASTER_KEY_FILE_NAME = 'master.key';
const MASTER_KEY_SIZE = 32; // 256-bit
const IV_SIZE = 12;
const TAG_SIZE = 16;
const CIPHER = 'aes-256-gcm';

export interface EncryptedFileStorageOptions {
    readonly directory: string;
    readonly masterKeyPath?: string;
}

export class EncryptedFileStorage implements SecureStorage {
    private readonly directory: string;
    private readonly masterKeyPath: string;

    constructor(options: EncryptedFileStorageOptions) {
        this.directory = options.directory;
        this.masterKeyPath = options.masterKeyPath ?? path.join(options.directory, MASTER_KEY_FILE_NAME);
    }

    async get(key: string): Promise<string | null> {
        const file = this.entryPath(key);
        if (!fs.existsSync(file)) return null;
        const masterKey = this.loadMasterKey();
        const blob = fs.readFileSync(file);
        if (blob.length < IV_SIZE + TAG_SIZE) {
            throw new Error(`corrupt credential file: ${file}`);
        }
        const iv = blob.subarray(0, IV_SIZE);
        const tag = blob.subarray(IV_SIZE, IV_SIZE + TAG_SIZE);
        const ct = blob.subarray(IV_SIZE + TAG_SIZE);
        const decipher = crypto.createDecipheriv(CIPHER, masterKey, iv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
        return plain.toString('utf8');
    }

    async set(key: string, value: string): Promise<void> {
        const masterKey = this.loadMasterKey();
        const iv = crypto.randomBytes(IV_SIZE);
        const cipher = crypto.createCipheriv(CIPHER, masterKey, iv);
        const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        this.ensureDirectory();
        fs.writeFileSync(this.entryPath(key), Buffer.concat([iv, tag, ct]), { mode: 0o600 });
    }

    async delete(key: string): Promise<void> {
        const file = this.entryPath(key);
        if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    async list(): Promise<string[]> {
        if (!fs.existsSync(this.directory)) return [];
        return fs.readdirSync(this.directory)
            .filter((name) => name.endsWith('.enc'))
            .map((name) => name.slice(0, -'.enc'.length));
    }

    private entryPath(key: string): string {
        const safe = key.replace(/[^A-Za-z0-9._-]/g, '_');
        return path.join(this.directory, `${safe}.enc`);
    }

    private ensureDirectory(): void {
        if (!fs.existsSync(this.directory)) {
            fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        }
    }

    private loadMasterKey(): Buffer {
        if (fs.existsSync(this.masterKeyPath)) {
            const buf = fs.readFileSync(this.masterKeyPath);
            if (buf.length !== MASTER_KEY_SIZE) {
                throw new Error(
                    `master key at ${this.masterKeyPath} is ${buf.length} bytes; expected ${MASTER_KEY_SIZE}`,
                );
            }
            return buf;
        }
        this.ensureDirectory();
        const key = crypto.randomBytes(MASTER_KEY_SIZE);
        fs.writeFileSync(this.masterKeyPath, key, { mode: 0o600 });
        return key;
    }
}

/**
 * In-memory SecureStorage for tests. Not persisted anywhere.
 */
export class InMemorySecureStorage implements SecureStorage {
    private readonly map = new Map<string, string>();

    async get(key: string): Promise<string | null> {
        return this.map.get(key) ?? null;
    }

    async set(key: string, value: string): Promise<void> {
        this.map.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.map.delete(key);
    }

    async list(): Promise<string[]> {
        return Array.from(this.map.keys());
    }
}
