// P23a — barrel for keybindings module.
export { DEFAULT_KEYBINDINGS } from './defaults.js';
export type { Keybinding } from './defaults.js';
export { matchKeys, keysMatch } from './match.js';
export type { InkKeyEvent } from './match.js';
export { loadUserKeybindings } from './load-user.js';
export { KeybindingProvider, useKeybindings } from './context.js';
export type { KeybindingContextValue, KeybindingProviderProps } from './context.js';
