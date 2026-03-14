import { describe, expect, it } from 'vitest';
import { resolveCtrlCAction } from './interrupt-policy.js';

describe('resolveCtrlCAction', () => {
    it('cancels in-flight requests on first Ctrl+C', () => {
        expect(resolveCtrlCAction({ runtimeStatus: 'thinking' }, false)).toBe('cancel-request');
        expect(resolveCtrlCAction({ runtimeStatus: 'running-tool' }, false)).toBe('cancel-request');
        expect(resolveCtrlCAction({ runtimeStatus: 'awaiting-approval' }, false)).toBe('cancel-request');
    });

    it('arms quit when idle and confirms on second Ctrl+C', () => {
        expect(resolveCtrlCAction({ runtimeStatus: 'idle' }, false)).toBe('arm-quit');
        expect(resolveCtrlCAction({ runtimeStatus: 'idle' }, true)).toBe('confirm-quit');
    });
});
