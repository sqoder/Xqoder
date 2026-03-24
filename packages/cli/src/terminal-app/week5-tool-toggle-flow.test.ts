import { describe, expect, it } from 'vitest';
import { createInitialTerminalAppState } from '../terminal-core/app-state.js';
import { withDerivedChrome } from '../terminal-core/runtime-bridge.js';
import { reduceTerminalAppState } from './reducer.js';
import { MouseHandler } from './mouse-handler.js';

describe('week5 tool toggle flow', () => {
    it('toggles context-group collapse/expand on repeated click', () => {
        let state = createInitialTerminalAppState({ width: 120, height: 30 });
        state = {
            ...state,
            transcriptEntries: [
                { id: 's1:tool:read_file:1', role: 'tool', content: 'read_file /repo/src/a.ts' },
                { id: 's1:tool:read_file:2', role: 'tool', content: 'read_file /repo/src/b.ts' },
                { id: 's1:tool:read_file:3', role: 'tool', content: 'read_file /repo/src/c.ts' },
            ],
        };
        state = withDerivedChrome(state);

        const collapsedLine = state.transcriptLines.findIndex((line) => line.includes('◈ Gathered context'));
        expect(collapsedLine).toBeGreaterThanOrEqual(0);

        const mouseHandler = new MouseHandler({
            dispatch: (event) => {
                state = reduceTerminalAppState(state, event);
            },
        });

        const firstHandled = mouseHandler.handleTranscriptClick(state, collapsedLine);
        expect(firstHandled).toBe(true);
        expect(state.notice).toBe('Context group expanded');
        expect(state.transcriptLines.join('\n')).toContain('◈ Gathered context');
        expect(state.transcriptLines.join('\n')).toContain('read_file /repo/src/a.ts');

        const secondHandled = mouseHandler.handleTranscriptClick(state, collapsedLine);
        expect(secondHandled).toBe(true);
        expect(state.notice).toBe('Context group collapsed');
        expect(state.transcriptLines.join('\n')).toContain('◈ Gathered context');
    });
});
