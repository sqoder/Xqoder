import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RustTuiState } from './rust-renderer.js';

const commitCalls: RustTuiState[] = [];

class MockRendererAdapter {
    commitState(state: RustTuiState): void {
        commitCalls.push(state);
    }
}

vi.mock('./rust-renderer.js', async () => {
    const actual = await vi.importActual<typeof import('./rust-renderer.js')>('./rust-renderer.js');
    return {
        ...actual,
        RustRendererAdapter: MockRendererAdapter,
    };
});

describe('rust tui state commit', () => {
    beforeEach(() => {
        commitCalls.length = 0;
        vi.resetModules();
    });

    it('omits transcript messages on pure viewport commits after the first full commit', async () => {
        const { rustTui } = await import('./rust-tui.js');
        const messages = [
            {
                id: 'u-1',
                role: 'user',
                timestamp: Date.now(),
                parts: [{ kind: 'text', content: 'hello' }],
            },
        ];
        const baseState = {
            page: 'chat',
            logLines: [],
            messages,
            input: { parts: [], cursorGrapheme: 0, mode: 'normal' },
            sidebar: {
                sessionId: 's-1',
                cwd: '/repo',
                model: 'gpt-4.1',
                agent: 'xqoder-agent',
                mode: 'default',
                contextUsed: 0,
                contextMax: 128000,
                costUsdThis: 0,
                costUsdToday: 0,
                todayMessages: 0,
                lspLines: [],
                dockerLines: [],
                dockerUrl: '',
            },
            status: { thinking: false, text: 'Ready' },
            scroll: { offsetLines: 0, maxScrollY: 0, contentLines: 1, stickyBottom: true, draggingScrollbar: false },
            layout: {
                header: { x: 0, y: 0, width: 80, height: 1 },
                messages: { x: 0, y: 1, width: 80, height: 18 },
                messagesScrollbar: null,
                input: { x: 0, y: 19, width: 80, height: 3 },
                footer: { x: 0, y: 22, width: 80, height: 2 },
                sidebar: { x: 80, y: 0, width: 0, height: 24 },
                hasSidebar: false,
            },
            overlay: undefined,
            tick: 0,
            blink: false,
        };

        rustTui.commitState(baseState);
        rustTui.commitState({
            ...baseState,
            scroll: { ...baseState.scroll, offsetLines: 12 },
        });

        expect(commitCalls).toHaveLength(2);
        expect(commitCalls[0].messages).toHaveLength(1);
        expect(commitCalls[1].messages).toBeUndefined();
    });
});
