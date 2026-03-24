import { describe, expect, it, vi } from 'vitest';
import { InterruptManager } from './interrupt-manager.js';

describe('InterruptManager', () => {
    it('cancels LLM when runtime is busy', async () => {
        const onCancelLLM = vi.fn(async () => {});
        const onExit = vi.fn(() => {});
        const manager = new InterruptManager({
            isLLMRunning: () => true,
            onCancelLLM,
            onExit,
        });

        manager.onCtrlCByte();
        await Promise.resolve();

        expect(onCancelLLM).toHaveBeenCalledTimes(1);
        expect(onExit).not.toHaveBeenCalled();
    });

    it('exits immediately when runtime is idle', () => {
        const onCancelLLM = vi.fn(async () => {});
        const onExit = vi.fn(() => {});
        const manager = new InterruptManager({
            isLLMRunning: () => false,
            onCancelLLM,
            onExit,
        });

        manager.onCtrlCKey();

        expect(onExit).toHaveBeenCalledTimes(1);
        expect(onCancelLLM).not.toHaveBeenCalled();
    });
});
