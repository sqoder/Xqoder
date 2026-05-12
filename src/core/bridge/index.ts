// P25b — barrel for @xqoder/core-bridge.

export { getWorkSecret, __resetWorkSecretForTests } from './work-secret.js';
export { signJwt, verifyJwt } from './jwt.js';
export type { JwtPayload, VerifyResult } from './jwt.js';
export {
    PAIRING_TTL_MS,
    createPairingCode,
    generateNumericCode,
    redeemPairingCode,
    validateBridgeJwt,
    __resetPairingCodesForTests,
} from './pairing.js';
export type { PairingResult } from './pairing.js';
export { createBridgeApiServer } from './bridge-api.js';
export type { BridgeApiOptions, BridgeApiServer } from './bridge-api.js';
export {
    activateReplBridge,
    deactivateReplBridge,
    getReplBridgeState,
    isReplBridgeActive,
} from './repl-bridge.js';
export type { ReplBridgeState } from './repl-bridge.js';
