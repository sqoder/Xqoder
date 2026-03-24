import { describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
    computeLayout: vi.fn(),
}));

vi.mock('./rust-tui.js', () => ({
    rustTui: {
        computeLayout: mocked.computeLayout,
    },
}));

import { createInitialTerminalAppState } from './app-state.js';
import { mapAppStateToTUIState } from './renderer.js';

describe('renderer input lines', () => {
    it('uses the shared input layout helper when projecting Rust layout input lines', () => {
        mocked.computeLayout.mockReturnValue({
            header: { x: 0, y: 0, width: 80, height: 1 },
            messages: { x: 0, y: 1, width: 80, height: 10 },
            messagesScrollbar: null,
            input: { x: 0, y: 11, width: 80, height: 3 },
            footer: { x: 0, y: 14, width: 80, height: 2 },
            sidebar: { x: 80, y: 0, width: 0, height: 16 },
            hasSidebar: false,
        });

        const base = createInitialTerminalAppState(
            { width: 80, height: 16 },
            { cwd: '/repo', model: 'gpt-4o', agent: 'general' },
        );
        mapAppStateToTUIState({
            ...base,
            editor: { ...base.editor, value: Array.from({ length: 20 }, (_, index) => `line-${index}`).join('\n') },
        });

        expect(mocked.computeLayout).toHaveBeenCalledWith(80, 16, 6);
    });
});
