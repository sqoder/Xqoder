import { describe, expect, it } from 'vitest';
import { createInitialTerminalAppState } from './app-state.js';
import { TerminalEventLoop } from './event-loop.js';
import { ScreenBuffer } from './screen-buffer.js';

describe('terminal event loop', () => {
    it('reduces events and writes diffed frames', async () => {
        const writes: string[][] = [];
        const loop = new TerminalEventLoop({
            initialState: createInitialTerminalAppState({ width: 40, height: 10 }),
            reduce(state, event) {
                if (event.type === 'timer') {
                    return { ...state, statusItems: [{ text: event.timerId }] };
                }
                return state;
            },
            render(state) {
                const buffer = ScreenBuffer.empty(state.size);
                buffer.writeText(0, 0, state.statusItems.map((item) => item.text).join(' '));
                return {
                    buffer,
                    patches: [],
                    cursor: { x: 0, y: 0, visible: true },
                };
            },
            writer: {
                write(result) {
                    writes.push(result.patches.map((patch) => patch.text));
                },
            },
        });

        loop.dispatch({ type: 'timer', timerId: 'tick', now: 1 });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(writes.length).toBe(1);
        expect(writes[0]?.[0]).toContain('tick');
    });
});
