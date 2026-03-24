import { describe, expect, it, vi } from 'vitest';
import { MouseHandler } from './mouse-handler.js';
import { rustTui } from '../terminal-core/rust-tui.js';

describe('MouseHandler', () => {
    it('toggles context group when clicking a grouped context entry line', () => {
        const dispatch = vi.fn();
        const handler = new MouseHandler({ dispatch });
        const handled = handler.handleTranscriptClick(
            {
                transcriptLines: ['  ◈ Gathered context · 3 reads · 2 unique sources'],
                transcriptCodeBlocks: [],
                diffExpandedBlockIds: [],
                transcriptEntryLineRanges: [{ entryId: 's1:tool:read_file:1:context-group:3', startLine: 0, endLine: 0 }],
                transcriptEntryLineStarts: [0],
                transcriptEntryLineEnds: [0],
            },
            0,
        );

        expect(handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'context.group.toggle',
            entryId: 's1:tool:read_file:1:context-group:3',
        });
    });

    it('toggles diff context when clicking folded marker line', () => {
        const dispatch = vi.fn();
        const handler = new MouseHandler({ dispatch });
        const handled = handler.handleTranscriptClick(
            {
                transcriptLines: ['  ... 8 unchanged lines (folded, press Enter)'],
                transcriptCodeBlocks: [{
                    id: 's1:tool:apply_patch:1:block:0',
                    startLine: 0,
                    endLine: 2,
                    language: 'diff',
                    text: '@@ -1,3 +1,3 @@',
                }],
                diffExpandedBlockIds: [],
                transcriptEntryLineRanges: [{ entryId: 's1:tool:apply_patch:1', startLine: 0, endLine: 2 }],
                transcriptEntryLineStarts: [0],
                transcriptEntryLineEnds: [2],
            },
            0,
        );

        expect(handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'diff.context.toggle',
            blockId: 's1:tool:apply_patch:1:block:0',
        });
    });

    it('does not fall back to ts range scans when rust line mapping misses', () => {
        const dispatch = vi.fn();
        const handler = new MouseHandler({ dispatch });
        const findEntryIndex = vi.spyOn(rustTui, 'findEntryIndex').mockReturnValue(-1);

        const handled = handler.handleTranscriptClick(
            {
                transcriptLines: ['  ◈ Gathered context · 3 reads · 2 unique sources'],
                transcriptCodeBlocks: [],
                diffExpandedBlockIds: [],
                transcriptEntryLineRanges: [{ entryId: 's1:tool:read_file:1:context-group:3', startLine: 0, endLine: 0 }],
                transcriptEntryLineStarts: [0],
                transcriptEntryLineEnds: [0],
            },
            0,
        );

        expect(handled).toBe(false);
        expect(dispatch).not.toHaveBeenCalled();
        findEntryIndex.mockRestore();
    });
});
