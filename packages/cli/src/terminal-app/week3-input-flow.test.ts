import { describe, expect, it } from 'vitest';
import { createInitialTerminalAppState } from '../terminal-core/app-state.js';
import { reduceTerminalAppState } from './reducer.js';

describe('Week3 input flow', () => {
    it('covers @ attach, pill delete, and / command filtering', () => {
        let state = createInitialTerminalAppState({ width: 120, height: 30 });

        state = reduceTerminalAppState(state, {
            type: 'overlay.open',
            kind: 'complete',
            currentDir: '/repo',
            items: [{ path: '/repo/src/app.ts', label: 'src/app.ts', isDir: false }],
        });
        state = reduceTerminalAppState(state, { type: 'overlay.closeWithSelect', kind: 'complete', path: '/repo/src/app.ts' });
        state = reduceTerminalAppState(state, {
            type: 'editor.append-attachment',
            attachment: { id: '/repo/src/app.ts', label: '@src/app.ts', kind: 'file', path: '/repo/src/app.ts' },
        });

        state = reduceTerminalAppState(state, {
            type: 'input',
            input: { type: 'key', key: 'backspace', raw: '\u0008' },
        });
        expect(state.editor.attachments).toHaveLength(0);

        state = reduceTerminalAppState(state, {
            type: 'overlay.open',
            kind: 'commands',
            items: [
                { id: 'session', label: 'Switch Session', description: 'restore session' },
                { id: 'model', label: 'Select Model', description: 'pick model' },
            ],
        });
        state = reduceTerminalAppState(state, { type: 'overlay.commandsFilter', query: 'sess' });

        expect(state.overlay?.type).toBe('commands');
        if (!state.overlay || state.overlay.type !== 'commands') {
            throw new Error('Expected commands overlay');
        }
        expect(state.overlay.items).toHaveLength(1);
        expect(state.overlay.items[0]?.id).toBe('session');
    });
});
