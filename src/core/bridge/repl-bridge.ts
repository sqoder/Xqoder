// P25b — REPL bridge: connects the local REPL session to the bridge API.
//
// When BRIDGE_MODE is enabled, the REPL registers itself with the bridge
// server so remote clients can attach and receive conversation event envelopes.

import { createPairingCode, type PairingResult } from './pairing.js';

export interface ReplBridgeState {
    pairingResult: PairingResult;
    sessionId: string;
}

let _state: ReplBridgeState | null = null;

export function activateReplBridge(sessionId: string): ReplBridgeState {
    const pairingResult = createPairingCode();
    _state = { pairingResult, sessionId };
    return _state;
}

export function getReplBridgeState(): ReplBridgeState | null {
    return _state;
}

export function deactivateReplBridge(): void {
    _state = null;
}

export function isReplBridgeActive(): boolean {
    return _state !== null;
}
