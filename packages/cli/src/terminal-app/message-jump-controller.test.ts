import { describe, expect, it, vi } from 'vitest';
import { MessageJumpController } from './message-jump-controller.js';

describe('MessageJumpController', () => {
    it('jumps to previous and next user/assistant boundaries with ctrl+arrow', () => {
        const dispatch = vi.fn();
        const state = {
            transcriptEntries: [
                { id: 'u1', role: 'user' },
                { id: 't1', role: 'tool' },
                { id: 'a1', role: 'assistant' },
            ],
            transcriptEntryLineRanges: [
                { entryId: 'u1', startLine: 1, endLine: 2 },
                { entryId: 't1', startLine: 3, endLine: 4 },
                { entryId: 'a1', startLine: 5, endLine: 6 },
            ],
            viewport: { anchorMessageId: 5, scrollOffset: 0, isFollowingBottom: true, selectedRange: null, viewportHeight: 30 },
            size: { width: 120, height: 30 },
            editor: { value: '', attachments: [], maxVisibleRows: 4 },
        };

        const controller = new MessageJumpController({
            getState: () => state,
            dispatch,
        });

        const upHandled = controller.handle({ type: 'key', key: 'up', ctrl: true, raw: '' });
        expect(upHandled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.focusLine.set', line: 1 });

        dispatch.mockClear();
        state.viewport.anchorMessageId = 1;
        const downHandled = controller.handle({ type: 'key', key: 'down', ctrl: true, raw: '' });
        expect(downHandled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.focusLine.set', line: 5 });
    });

    it('supports role-filtered jumps and keeps alt+arrow compatibility', () => {
        const dispatch = vi.fn();
        const state = {
            transcriptEntries: [
                { id: 'u1', role: 'user' },
                { id: 'a1', role: 'assistant' },
                { id: 'u2', role: 'user' },
                { id: 'a2', role: 'assistant' },
            ],
            transcriptEntryLineRanges: [
                { entryId: 'u1', startLine: 1, endLine: 1 },
                { entryId: 'a1', startLine: 3, endLine: 3 },
                { entryId: 'u2', startLine: 5, endLine: 5 },
                { entryId: 'a2', startLine: 7, endLine: 7 },
            ],
            viewport: { anchorMessageId: 1, scrollOffset: 0, isFollowingBottom: true, selectedRange: null, viewportHeight: 30 },
            size: { width: 120, height: 30 },
            editor: { value: '', attachments: [], maxVisibleRows: 4 },
        };
        const controller = new MessageJumpController({ getState: () => state, dispatch });

        controller.handle({ type: 'key', key: 'down', ctrl: true, shift: true, raw: '' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.focusLine.set', line: 3 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'notice.set', notice: 'Jumped to assistant boundary (4)' });

        dispatch.mockClear();
        state.viewport.anchorMessageId = 3;
        controller.handle({ type: 'key', key: 'down', ctrl: true, alt: true, raw: '' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.focusLine.set', line: 5 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'notice.set', notice: 'Jumped to user boundary (6)' });

        dispatch.mockClear();
        state.viewport.anchorMessageId = 5;
        controller.handle({ type: 'key', key: 'down', alt: true, raw: '' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.focusLine.set', line: 7 });
    });

    it('does not force viewport jump when projected chat viewport fallback already keeps target visible', () => {
        const dispatch = vi.fn();
        const state = {
            transcriptEntries: [
                { id: 'u1', role: 'user' },
                { id: 'a1', role: 'assistant' },
            ],
            transcriptEntryLineRanges: [
                { entryId: 'u1', startLine: 1, endLine: 1 },
                { entryId: 'a1', startLine: 5, endLine: 5 },
            ],
            viewport: { anchorMessageId: 1, scrollOffset: 0, isFollowingBottom: true, selectedRange: null, viewportHeight: 0 },
            size: { width: 80, height: 24 },
            editor: { value: '', attachments: [], maxVisibleRows: 4 },
        };
        const controller = new MessageJumpController({ getState: () => state, dispatch });

        const handled = controller.handle({ type: 'key', key: 'down', ctrl: true, raw: '' });
        expect(handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.focusLine.set', line: 5 });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'viewport.intent.jump' }));
    });
});
