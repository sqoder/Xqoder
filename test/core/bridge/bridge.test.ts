// P25b — Bridge JWT + pairing unit tests.

import { afterEach, describe, expect, it } from 'bun:test';
import {
    __resetWorkSecretForTests,
    getWorkSecret,
    signJwt,
    verifyJwt,
    createPairingCode,
    redeemPairingCode,
    validateBridgeJwt,
    __resetPairingCodesForTests,
    PAIRING_TTL_MS,
} from '../../../src/core/bridge/index.js';

afterEach(() => {
    __resetWorkSecretForTests();
    __resetPairingCodesForTests();
});

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

describe('signJwt / verifyJwt', () => {
    it('round-trips a valid token', () => {
        const secret = getWorkSecret();
        const payload = { scope: 'bridge', exp: Date.now() + 60_000 };
        const token = signJwt(payload, secret);
        const result = verifyJwt(token, secret);
        expect(result.valid).toBe(true);
        expect(result.payload?.scope).toBe('bridge');
    });

    it('rejects a tampered token', () => {
        const secret = getWorkSecret();
        const token = signJwt({ scope: 'bridge', exp: Date.now() + 60_000 }, secret);
        const tampered = token.slice(0, -4) + 'XXXX';
        expect(verifyJwt(tampered, secret).valid).toBe(false);
    });

    it('rejects an expired token', () => {
        const secret = getWorkSecret();
        const token = signJwt({ scope: 'bridge', exp: Date.now() - 1 }, secret);
        const result = verifyJwt(token, secret);
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/expired/);
    });

    it('rejects a malformed token', () => {
        const secret = getWorkSecret();
        expect(verifyJwt('not.a.token', secret).valid).toBe(false);
        expect(verifyJwt('only.two', secret).valid).toBe(false);
    });

    it('rejects a token signed with a different secret', () => {
        const secret1 = Buffer.from('secret1'.padEnd(32, '0'));
        const secret2 = Buffer.from('secret2'.padEnd(32, '0'));
        const token = signJwt({ scope: 'bridge', exp: Date.now() + 60_000 }, secret1);
        expect(verifyJwt(token, secret2).valid).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

describe('createPairingCode / redeemPairingCode', () => {
    it('creates a 6-digit code', () => {
        const result = createPairingCode();
        expect(result.code).toMatch(/^\d{6}$/);
        expect(result.expiresAt).toBeGreaterThan(Date.now());
        expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + PAIRING_TTL_MS + 100);
    });

    it('redeems a valid code and returns JWT', () => {
        const { code } = createPairingCode();
        const jwt = redeemPairingCode(code);
        expect(typeof jwt).toBe('string');
        expect(jwt!.split('.').length).toBe(3);
    });

    it('code can only be redeemed once', () => {
        const { code } = createPairingCode();
        redeemPairingCode(code);
        expect(redeemPairingCode(code)).toBeNull();
    });

    it('returns null for unknown code', () => {
        expect(redeemPairingCode('000000')).toBeNull();
    });

    it('validateBridgeJwt accepts a freshly issued JWT', () => {
        const { jwt } = createPairingCode();
        expect(validateBridgeJwt(jwt)).toBe(true);
    });

    it('validateBridgeJwt rejects garbage', () => {
        expect(validateBridgeJwt('garbage')).toBe(false);
    });
});
