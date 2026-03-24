import { describe, expect, it } from 'vitest';
import { createInitialTerminalAppState } from './app-state.js';
import { mapAppStateToTUIState } from './renderer.js';

describe('renderer bridge', () => {
    it('uses renderer-facing status view model instead of runtime fields directly', () => {
        const base = createInitialTerminalAppState(
            { width: 100, height: 30 },
            { cwd: '/repo', model: 'gpt-4o', agent: 'general' },
        );
        const state = {
            ...base,
            runtimeStatus: 'thinking' as const,
            rendererStatus: {
                thinking: false,
                text: 'Awaiting approval',
                contextUsed: 321,
                contextMax: 128000,
            },
        };

        const tuiState = mapAppStateToTUIState(state);

        expect(tuiState.status).toEqual({
            thinking: false,
            text: 'Awaiting approval',
        });
        expect(tuiState.sidebar.contextUsed).toBe(321);
        expect(tuiState.sidebar.contextMax).toBe(128000);
    });

    it('reuses mapped transcript messages when only viewport state changes', () => {
        const base = createInitialTerminalAppState(
            { width: 100, height: 30 },
            { cwd: '/repo', model: 'gpt-4o', agent: 'general' },
        );
        const firstState = {
            ...base,
            transcriptEntries: [
                { id: 'u-1', role: 'user' as const, content: 'hello' },
                { id: 'a-1', role: 'assistant' as const, content: 'world' },
            ],
        };

        const first = mapAppStateToTUIState(firstState);
        const second = mapAppStateToTUIState({
            ...firstState,
            viewport: {
                ...firstState.viewport,
                scrollOffset: 12,
            },
        });

        expect(second.messages).toBe(first.messages);
    });
});
