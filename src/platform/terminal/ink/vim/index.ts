// P23b/P23-follow-up — barrel for vim module.
export { createVimState, __resetVimState } from './state.js';
export type { VimState, VimMode } from './state.js';
export { applyMotion } from './motions.js';
export { applyOperator, pasteRegister, deleteLine, yankLine } from './operators.js';
export type { OperatorResult } from './operators.js';
export { processNormalKey, processInsertKey, processVisualKey } from './transitions.js';
export type { VimTransitionResult } from './transitions.js';
