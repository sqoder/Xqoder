import type { EntryLineRange } from './transcript-blocks.js';
import { rustTui } from './rust-tui.js';

export interface TranscriptLineMappingState {
    transcriptEntryLineRanges: EntryLineRange[];
    transcriptEntryLineStarts: number[];
    transcriptEntryLineEnds: number[];
}

export function findTranscriptEntryRangeIndexAtLine(state: TranscriptLineMappingState, line: number): number {
    return rustTui.findEntryIndex(
        state.transcriptEntryLineStarts,
        state.transcriptEntryLineEnds,
        line,
    );
}

export function getTranscriptEntryRangeAtLine(
    state: TranscriptLineMappingState,
    line: number,
): EntryLineRange | null {
    const rangeIndex = findTranscriptEntryRangeIndexAtLine(state, line);
    if (rangeIndex < 0) {
        return null;
    }
    return state.transcriptEntryLineRanges[rangeIndex] ?? null;
}
