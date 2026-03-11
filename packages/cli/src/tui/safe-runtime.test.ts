import { describe, expect, it, vi } from 'vitest';
import { installSafeRuntimeGuards, isIgnorableTuiWarning } from './safe-runtime.js';

describe('safe runtime guards', () => {
    it('ignores sqlite experimental warnings', () => {
        expect(isIgnorableTuiWarning('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning')).toBe(true);
        expect(isIgnorableTuiWarning(new Error('SQLite is an experimental feature and might change at any time'), 'ExperimentalWarning')).toBe(true);
    });

    it('preserves non-sqlite warnings', () => {
        expect(isIgnorableTuiWarning('something else', 'ExperimentalWarning')).toBe(false);
        expect(isIgnorableTuiWarning('deprecation', 'DeprecationWarning')).toBe(false);
    });

    it('swallows sqlite experimental warnings and restores original emitWarning', () => {
        const originalEmitWarning = vi.fn();
        const host = {
            emitWarning: originalEmitWarning,
        };

        const restore = installSafeRuntimeGuards(host);

        host.emitWarning('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning');
        expect(originalEmitWarning).not.toHaveBeenCalled();

        host.emitWarning('different warning', 'ExperimentalWarning');
        expect(originalEmitWarning).toHaveBeenCalledOnce();

        restore();
        host.emitWarning('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning');
        expect(originalEmitWarning).toHaveBeenCalledTimes(2);
    });
});
