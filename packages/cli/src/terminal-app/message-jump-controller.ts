import type { TerminalInputEvent } from '../terminal-core/input-parser.js';
import { getProjectedTranscriptViewportHeight } from '../terminal-core/runtime-bridge.js';

interface MessageJumpDeps {
    getState: () => any;
    dispatch: (event: unknown) => void;
}

export class MessageJumpController {
    constructor(private readonly deps: MessageJumpDeps) {}

    handle(input: TerminalInputEvent): boolean {
        if (input.type !== 'key' || (input.key !== 'up' && input.key !== 'down')) {
            return false;
        }

        const jumpShortcut = input.ctrl || input.alt;
        if (!jumpShortcut) {
            return false;
        }

        const roleFilter: 'both' | 'assistant' | 'user' = input.shift
            ? 'assistant'
            : (input.ctrl && input.alt)
                ? 'user'
                : 'both';

        const state = this.deps.getState();
        if (!state.transcriptEntryLineRanges || state.transcriptEntryLineRanges.length === 0) {
            return false;
        }

        const roleById = new Map<string, string>();
        for (const entry of state.transcriptEntries) {
            roleById.set(entry.id, entry.role);
        }
        const ranges = state.transcriptEntryLineRanges
            .filter((range: any) => {
                const role = roleById.get(range.entryId);
                if (roleFilter === 'assistant') return role === 'assistant';
                if (roleFilter === 'user') return role === 'user';
                return role === 'user' || role === 'assistant';
            })
            .map((range: any) => range.startLine)
            .sort((a: number, b: number) => a - b);

        if (ranges.length === 0) {
            return false;
        }

        const currentTopLine = state.viewport.scrollOffset;
        const currentLine = state.viewport.anchorMessageId ?? currentTopLine;
        let target: number | null = null;
        if (input.key === 'up') {
            for (let i = ranges.length - 1; i >= 0; i -= 1) {
                if (ranges[i]! < currentLine) {
                    target = ranges[i]!;
                    break;
                }
            }
        } else {
            for (const line of ranges) {
                if (line > currentLine) {
                    target = line;
                    break;
                }
            }
        }

        if (target == null) {
            return true;
        }

        this.deps.dispatch({ type: 'viewport.focusLine.set', line: target });
        const height = getProjectedTranscriptViewportHeight(state);
        if (target < currentTopLine || target >= currentTopLine + height) {
            this.deps.dispatch({ type: 'viewport.intent.jump', targetLine: target, anchorNumerator: 1, anchorDenominator: 3 });
        }
        const kind = roleFilter === 'assistant' ? 'assistant' : roleFilter === 'user' ? 'user' : 'message';
        this.deps.dispatch({ type: 'notice.set', notice: `Jumped to ${kind} boundary (${target + 1})` });
        return true;
    }
}
