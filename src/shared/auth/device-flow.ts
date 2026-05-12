// P21a — OAuth 2.0 Device Authorization Grant (RFC 8628).
//
// GitHub Models and some other providers use device flow instead of PKCE.
// This module provides pure helpers + the polling loop; actual browser open
// and user code display is left to the caller.

import type { OAuthTokens } from './types.js';
import { parseTokenResponse } from './oauth-client.js';

export interface DeviceAuthorizationResponse {
    readonly deviceCode: string;
    readonly userCode: string;
    readonly verificationUri: string;
    readonly verificationUriComplete?: string;
    readonly expiresIn: number;
    readonly intervalSeconds: number;
}

export interface RequestDeviceCodeParams {
    readonly deviceAuthorizationEndpoint: string;
    readonly clientId: string;
    readonly scope: string;
    readonly fetch?: typeof globalThis.fetch;
}

export async function requestDeviceCode(
    params: RequestDeviceCodeParams,
): Promise<DeviceAuthorizationResponse> {
    const doFetch = params.fetch ?? globalThis.fetch;
    const body = new URLSearchParams({ client_id: params.clientId, scope: params.scope });
    const response = await doFetch(params.deviceAuthorizationEndpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'accept': 'application/json',
        },
        body: body.toString(),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`device auth endpoint ${response.status}: ${text || response.statusText}`);
    }
    const record = JSON.parse(text) as Record<string, unknown>;
    const deviceCode = record['device_code'];
    const userCode = record['user_code'];
    const verificationUri = record['verification_uri'];
    if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUri !== 'string') {
        throw new Error('device auth response missing required fields');
    }
    return {
        deviceCode,
        userCode,
        verificationUri,
        ...(typeof record['verification_uri_complete'] === 'string'
            ? { verificationUriComplete: record['verification_uri_complete'] }
            : {}),
        expiresIn: typeof record['expires_in'] === 'number' ? record['expires_in'] : 600,
        intervalSeconds: typeof record['interval'] === 'number' ? record['interval'] : 5,
    };
}

export interface PollDeviceTokenParams {
    readonly tokenEndpoint: string;
    readonly clientId: string;
    readonly deviceCode: string;
    readonly intervalSeconds: number;
    readonly expiresIn: number;
    readonly fetch?: typeof globalThis.fetch;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly now?: () => number;
}

/**
 * Polls the token endpoint until the user authorizes the device code, rate-
 * limits per RFC 8628 (slow_down → +5s), or the device code expires.
 */
export async function pollDeviceToken(params: PollDeviceTokenParams): Promise<OAuthTokens> {
    const doFetch = params.fetch ?? globalThis.fetch;
    const sleep = params.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const now = params.now ?? (() => Date.now());
    let interval = Math.max(params.intervalSeconds, 1);
    const deadline = now() + params.expiresIn * 1000;

    while (now() < deadline) {
        await sleep(interval * 1000);
        const body = new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: params.clientId,
            device_code: params.deviceCode,
        });
        const response = await doFetch(params.tokenEndpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'accept': 'application/json',
            },
            body: body.toString(),
        });
        const text = await response.text();
        let record: Record<string, unknown>;
        try {
            record = JSON.parse(text) as Record<string, unknown>;
        } catch {
            throw new Error(`device token endpoint returned non-JSON: ${text.slice(0, 200)}`);
        }
        if (response.ok) {
            return parseTokenResponse(record, now());
        }
        const error = typeof record['error'] === 'string' ? record['error'] : '';
        if (error === 'authorization_pending') continue;
        if (error === 'slow_down') {
            interval += 5;
            continue;
        }
        throw new Error(`device token endpoint ${response.status} ${error}: ${text.slice(0, 200)}`);
    }
    throw new Error('device code expired before user completed authorization');
}
