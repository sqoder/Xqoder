// P25b — Bridge pairing: generate + validate 6-digit pairing codes.
//
// A pairing code is a short-lived numeric code that a mobile/browser client
// exchanges for a JWT. The code expires after PAIRING_TTL_MS (5 min).

import * as crypto from 'node:crypto';
import { signJwt, verifyJwt, type JwtPayload } from './jwt.js';
import { getWorkSecret } from './work-secret.js';

export const PAIRING_TTL_MS = 5 * 60 * 1000;

export interface PairingResult {
    code: string;
    jwt: string;
    expiresAt: number;
}

// In-memory store: code → jwt (expires with the jwt)
const pairingCodes = new Map<string, string>();

export function generateNumericCode(digits = 6): string {
    const max = Math.pow(10, digits);
    const n = crypto.randomInt(max);
    return String(n).padStart(digits, '0');
}

export function createPairingCode(): PairingResult {
    const code = generateNumericCode(6);
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    const payload: JwtPayload = { scope: 'bridge', exp: expiresAt };
    const jwt = signJwt(payload, getWorkSecret());
    pairingCodes.set(code, jwt);

    // Auto-expire
    setTimeout(() => pairingCodes.delete(code), PAIRING_TTL_MS).unref();

    return { code, jwt, expiresAt };
}

export function redeemPairingCode(code: string): string | null {
    const jwt = pairingCodes.get(code);
    if (!jwt) return null;
    pairingCodes.delete(code);
    return jwt;
}

export function validateBridgeJwt(token: string): boolean {
    const result = verifyJwt(token, getWorkSecret());
    return result.valid && result.payload?.scope === 'bridge';
}

/** For tests only. */
export function __resetPairingCodesForTests(): void {
    pairingCodes.clear();
}
