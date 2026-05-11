// P17 — Output-style module barrel.
export {
    loadOutputStylesDir,
    type OutputStyleFile,
    type OutputStyleResponseFormat,
} from './load-dir.js';
export { appendOutputStyleTail } from './inject.js';
export {
    loadOutputStyleRegistry,
    resolveOutputStyleSearchRoots,
    type OutputStyleRegistry,
    type LoadOutputStyleRegistryOptions,
} from './registry.js';
export {
    clearOutputStyleSelection,
    getOutputStyleSelectionPath,
    readOutputStyleSelection,
    writeOutputStyleSelection,
} from './selection.js';
export { resolveActiveOutputStyleTail } from './resolve-active.js';
