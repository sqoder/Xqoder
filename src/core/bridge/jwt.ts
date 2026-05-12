// P25b — Minimal JWT: sign + verify HS256 tokens for bridge pairing.
//
// No third-party JWT library — we implement the minimal HS256 subset needed
// for bridge pairing codes. Tokens are short-lived (5 min default).

import * as crypto from 'node:crypto';

export interface JwtPayload {
    scope: string;
    exp: number;
    [key: string]: unknown;
}

function base64url(buf: Buffer | string): string {
    const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
    return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(s: string): Buffer {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(padded, 'base64');
}

const HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export function signJwt(payload: JwtPayload, secret: Buffer): string {
    const body = base64url(JSON.stringify(payload));
    const sigInput = `${HEADER}.${body}`;
    const sig = crypto.createHmac('sha256', secret).update(sigInput).digest();
    return `${sigInput}.${base64url(sig)}`;
}

export interface VerifyResult {
    valid: boolean;
    payload?: JwtPayload;
    reason?: string;
}

export function verifyJwt(token: string, secret: Buffer): VerifyResult {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, reason: 'malformed token' };

    const [header, body, sig] = parts as [string, string, string];
    const sigInput = `${header}.${body}`;
    const expected = crypto.createHmac('sha256', secret).update(sigInput).digest();
    const actual = base64urlDecode(sig);

    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return { valid: false, reason: 'invalid signature' };
    }

    let payload: JwtPayload;
    try {
        payload = JSON.parse(base64urlDecode(body).toString('utf-8')) as JwtPayload;
    } catch {
        return { valid: false, reason: 'malformed payload' };
    }

    if (typeof payload.exp === 'number' && Date.now() > payload.exp) {
        return { valid: false, reason: 'token expired' };
    }

    return { valid: true, payload };
}
