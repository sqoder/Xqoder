import { describe, expect, it, vi } from 'vitest';
import {
    copyViewportSelection,
    getCopyTargetAtLine,
    getFirstVisibleCodeBlockTarget,
    getFocusedCopyTarget,
    getTranscriptCopyHotspotTarget,
    getTranscriptCopyHotspotBounds,
    resolveViewportCopyTarget,
} from './copy-action.js';
import { rustTui } from './rust-tui.js';

describe('copy-action line mapping', () => {
    it('resolves message targets through rust entry mapping', () => {
        const target = getCopyTargetAtLine({
            transcriptLines: ['user', 'assistant'],
            transcriptCodeBlocks: [],
            transcriptEntryLineRanges: [
                { entryId: 'm1', startLine: 0, endLine: 0 },
                { entryId: 'm2', startLine: 1, endLine: 1 },
            ],
            transcriptEntryLineStarts: [0, 1],
            transcriptEntryLineEnds: [0, 1],
        } as any, 1);

        expect(target).toEqual({ kind: 'message', messageId: 'm2' });
    });

    it('does not fall back to ts scans when rust line mapping misses', () => {
        const findEntryIndex = vi.spyOn(rustTui, 'findEntryIndex').mockReturnValue(-1);

        const target = getCopyTargetAtLine({
            transcriptLines: ['assistant'],
            transcriptCodeBlocks: [],
            transcriptEntryLineRanges: [{ entryId: 'm1', startLine: 0, endLine: 0 }],
            transcriptEntryLineStarts: [0],
            transcriptEntryLineEnds: [0],
        } as any, 0);

        expect(target).toBeNull();
        findEntryIndex.mockRestore();
    });

    it('prefers projected viewport height for the first visible code block target', () => {
        const target = getFirstVisibleCodeBlockTarget({
            size: { width: 80, height: 24 },
            page: 'chat',
            transcriptLines: ['line 0', 'line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6'],
            transcriptCodeBlocks: [
                { id: 'cb1', startLine: 6, endLine: 6, language: 'ts', text: 'console.log(1);' },
            ],
            transcriptEntryLineRanges: [],
            transcriptEntryLineStarts: [],
            transcriptEntryLineEnds: [],
            viewport: { scrollOffset: 4, viewportHeight: 2 },
        } as any);

        expect(target).toBeNull();
    });

    it('falls back to transcript height when projected viewport height is unavailable', () => {
        const target = getFirstVisibleCodeBlockTarget({
            size: { width: 80, height: 24 },
            page: 'chat',
            transcriptLines: Array.from({ length: 24 }, (_, index) => `line ${index}`),
            transcriptCodeBlocks: [
                { id: 'cb1', startLine: 15, endLine: 15, language: 'ts', text: 'console.log(1);' },
            ],
            transcriptEntryLineRanges: [],
            transcriptEntryLineStarts: [],
            transcriptEntryLineEnds: [],
            viewport: { scrollOffset: 0, viewportHeight: 0 },
        } as any);

        expect(target).toEqual({ kind: 'code-block', blockId: 'cb1' });
    });

    it('centralizes transcript copy hotspot bounds', () => {
        expect(getTranscriptCopyHotspotBounds(80)).toEqual({ left: 68, right: 80 });
        expect(getTranscriptCopyHotspotBounds(8)).toEqual({ left: 0, right: 8 });
    });

    it('resolves the focused copy target from the viewport anchor line', () => {
        const target = getFocusedCopyTarget({
            viewport: { anchorMessageId: 1 },
            transcriptLines: ['user', 'assistant'],
            transcriptCodeBlocks: [],
            transcriptEntryLineRanges: [
                { entryId: 'm1', startLine: 0, endLine: 0 },
                { entryId: 'm2', startLine: 1, endLine: 1 },
            ],
            transcriptEntryLineStarts: [0, 1],
            transcriptEntryLineEnds: [0, 1],
        } as any);

        expect(target).toEqual({ kind: 'message', messageId: 'm2' });
    });

    it('prefers the focused copy target before visible block fallback', () => {
        const target = resolveViewportCopyTarget({
            size: { width: 80, height: 24 },
            page: 'chat',
            viewport: { anchorMessageId: 0, scrollOffset: 0, viewportHeight: 2 },
            transcriptLines: ['assistant', '```ts', 'console.log(1)', '```'],
            transcriptCodeBlocks: [{ id: 'cb1', startLine: 1, endLine: 3, language: 'ts', text: 'console.log(1)' }],
            transcriptEntryLineRanges: [{ entryId: 'm1', startLine: 0, endLine: 0 }],
            transcriptEntryLineStarts: [0],
            transcriptEntryLineEnds: [0],
        } as any, 'visible-code-block');

        expect(target).toEqual({ kind: 'message', messageId: 'm1' });
    });

    it('falls back to the latest assistant target when configured', () => {
        const target = resolveViewportCopyTarget({
            viewport: { anchorMessageId: null },
            transcriptLines: [],
            transcriptCodeBlocks: [],
            transcriptEntryLineRanges: [],
            transcriptEntryLineStarts: [],
            transcriptEntryLineEnds: [],
        } as any, 'latest-assistant');

        expect(target).toEqual({ kind: 'message-latest-assistant' });
    });

    it('keeps transcript copy hotspot restricted to code blocks', () => {
        const target = getTranscriptCopyHotspotTarget({
            transcriptLines: ['user', 'assistant'],
            transcriptCodeBlocks: [],
            transcriptEntryLineRanges: [
                { entryId: 'm1', startLine: 0, endLine: 0 },
                { entryId: 'm2', startLine: 1, endLine: 1 },
            ],
            transcriptEntryLineStarts: [0, 1],
            transcriptEntryLineEnds: [0, 1],
        } as any, 1);

        expect(target).toBeNull();
    });

    it('copies viewport selection text with shared trim and clear-selection flow', async () => {
        const clipboard = {
            writeText: vi.fn(async () => undefined),
            readText: vi.fn(async () => ''),
        };
        const dispatch = vi.fn();
        const renderNow = vi.fn(async () => undefined);

        const handled = copyViewportSelection(
            ['alpha  ', 'beta  '],
            {
                start: { line: 0, column: 0 },
                end: { line: 1, column: 6 },
            },
            clipboard,
            dispatch,
            renderNow,
            undefined,
            { ttl: 3000, clearSelectionOnEmpty: true },
        );

        expect(handled).toBe(true);
        expect(clipboard.writeText).toHaveBeenCalledWith('alpha  \nbeta');
        await Promise.resolve();
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'toast.push',
            text: 'Copied to clipboard',
            ttl: 3000,
        }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.selection.set', selection: null });
        expect(renderNow).toHaveBeenCalled();
    });

    it('can clear an empty viewport selection without copying', () => {
        const clipboard = {
            writeText: vi.fn(async () => undefined),
            readText: vi.fn(async () => ''),
        };
        const dispatch = vi.fn();

        const handled = copyViewportSelection(
            [''],
            {
                start: { line: 0, column: 0 },
                end: { line: 0, column: 1 },
            },
            clipboard,
            dispatch,
            vi.fn(async () => undefined),
            undefined,
            { clearSelectionOnEmpty: true },
        );

        expect(handled).toBe(true);
        expect(clipboard.writeText).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.selection.set', selection: null });
    });
});
