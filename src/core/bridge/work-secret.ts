// P25b — Work secret: per-process shared secret for bridge JWT signing.
//
// The secret is generated once per daemon process and stored in memory.
// It is never written to disk — bridge sessions are ephemeral.

import * as crypto from 'node:crypto';

let _workSecret: Buffer | null = null;

export function getWorkSecret(): Buffer {
    if (!_workSecret) {
        _workSecret = crypto.randomBytes(32);
    }
    return _workSecret;
}

/** For tests only. */
export function __resetWorkSecretForTests(): void {
    _workSecret = null;
}
