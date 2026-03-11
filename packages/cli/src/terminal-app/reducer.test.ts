import { describe, expect, it } from 'vitest';
import { createInitialTerminalAppState } from '../terminal-core/app-state.js';
import { reduceTerminalAppState } from './reducer.js';

describe('terminal app reducer', () => {
    it('routes text input into the editor model and runtime events into transcript state', () => {
        let state = createInitialTerminalAppState({ width: 80, height: 24 });
        state = reduceTerminalAppState(state, {
            type: 'input',
            input: { type: 'text', text: 'hello', raw: 'hello' },
        });

        expect(state.editor.value).toBe('hello');

        state = reduceTerminalAppState(state, {
            type: 'runtime',
            event: {
                type: 'message.completed',
                sessionId: 'session-1',
                timestamp: 10,
                source: 'agent',
                message: {
                    id: 'assistant-1',
                    sessionId: 'session-1',
                    role: 'assistant',
                    content: 'hi there',
                    createdAt: 10,
                },
            },
        });

        expect(state.transcriptLines.join('\n')).toContain('hi there');
    });
});
