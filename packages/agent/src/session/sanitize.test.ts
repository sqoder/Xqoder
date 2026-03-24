import { describe, expect, it } from 'vitest';
import { sanitizeForPersistence, sanitizeMessageForPersistence } from './sanitize.js';

describe('sanitizeForPersistence', () => {
    it('redacts Bearer token', () => {
        expect(sanitizeForPersistence('Use Bearer sk-abc123xyz')).toContain('***');
        expect(sanitizeForPersistence('Use Bearer sk-abc123xyz')).not.toContain('sk-abc123xyz');
    });

    it('redacts Authorization header', () => {
        const out = sanitizeForPersistence('Authorization: Bearer my-secret-token');
        expect(out).toContain('***');
        expect(out).not.toContain('my-secret-token');
    });

    it('redacts api_key= value', () => {
        const out = sanitizeForPersistence('API_KEY=sk-12345678901234567890');
        expect(out).toContain('***');
        expect(out).not.toContain('sk-12345678901234567890');
    });

    it('redacts .env style sensitive keys', () => {
        const out = sanitizeForPersistence('OPENAI_API_KEY=sk-secret\nANTHROPIC_API_KEY=key99');
        expect(out).not.toMatch(/sk-secret|key99/);
        expect(out).toContain('***');
    });

    it('leaves non-sensitive content unchanged', () => {
        const text = 'Just a normal message with no secrets.';
        expect(sanitizeForPersistence(text)).toBe(text);
    });
});

describe('sanitizeMessageForPersistence', () => {
    it('sanitizes content and thinking', () => {
        const msg = {
            role: 'user' as const,
            content: 'Bearer sk-abc123',
            thinking: 'token=secret',
        };
        const out = sanitizeMessageForPersistence(msg);
        expect(out.content).not.toContain('sk-abc123');
        expect(out.content).toContain('***');
        expect(out.thinking).not.toContain('secret');
        expect(out.thinking).toContain('***');
    });

    it('replaces attachment data with placeholder', () => {
        const msg = {
            role: 'user' as const,
            content: 'hi',
            attachments: [{ kind: 'image' as const, type: 'image' as const, mimeType: 'image/png', data: 'base64longstring' }],
        };
        const out = sanitizeMessageForPersistence(msg);
        expect(Array.isArray(out.attachments)).toBe(true);
        expect((out.attachments as Array<{ data?: string }>)[0]?.data).toMatch(/attachment omitted/);
        expect((out.attachments as Array<{ data?: string }>)[0]?.data).not.toBe('base64longstring');
    });
});
