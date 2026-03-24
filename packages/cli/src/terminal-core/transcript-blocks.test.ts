import { describe, expect, it } from 'vitest';
import { rebuildTranscriptWithCodeBlocks } from './transcript-blocks.js';
import type { TerminalTranscriptEntry } from './app-state.js';

describe('transcript blocks ordering', () => {
    it('preserves event order so thinking/details stream in sequence', () => {
        const entries: TerminalTranscriptEntry[] = [
            { id: 'a1', role: 'assistant', content: 'Final answer body' },
            { id: 's1:meta:phase:1', role: 'tool', content: 'Calling tools' },
        ];

        const result = rebuildTranscriptWithCodeBlocks(entries, 80);
        expect(result.entryLineRanges[0]?.entryId).toBe('a1');
        expect(result.entryLineRanges[1]?.entryId).toBe('s1:meta:phase:1');
        expect(result.lines.join('\n')).toContain('Thinking: Calling tools');
    });

    it('can promote trailing tool events before latest assistant while active', () => {
        const entries: TerminalTranscriptEntry[] = [
            { id: 'a1', role: 'assistant', content: 'Final answer body' },
            { id: 's1:meta:phase:1', role: 'tool', content: 'Running list_files' },
            { id: 's1:tool:list_files:2', role: 'tool', content: 'list_files', isStreaming: true },
        ];

        const result = rebuildTranscriptWithCodeBlocks(entries, 80, {
            promoteTrailingToolEventsBeforeAssistant: true,
        });
        expect(result.entryLineRanges[0]?.entryId).toBe('s1:meta:phase:1');
        expect(result.entryLineRanges[1]?.entryId).toBe('s1:tool:list_files:2');
        expect(result.entryLineRanges[2]?.entryId).toBe('a1');
    });

    it('promotes tool events before assistant even with non-tool events mixed in', () => {
        const entries: TerminalTranscriptEntry[] = [
            { id: 'a1', role: 'assistant', content: 'I will now execute.' },
            { id: 's1:meta:phase:1', role: 'tool', content: 'Running list_files' },
            { id: 'sys:1', role: 'system', content: 'internal debug output' },
        ];

        const result = rebuildTranscriptWithCodeBlocks(entries, 80, {
            promoteTrailingToolEventsBeforeAssistant: true,
        });
        expect(result.entryLineRanges[0]?.entryId).toBe('s1:meta:phase:1');
        expect(result.entryLineRanges[1]?.entryId).toBe('a1');
        expect(result.entryLineRanges[2]?.entryId).toBe('sys:1');
    });

    it('merges consecutive context reads and reports unique sources', () => {
        const entries: TerminalTranscriptEntry[] = [
            { id: 's1:tool:read_file:1', role: 'tool', content: 'read_file /repo/src/a.ts' },
            { id: 's1:tool:read_file:2', role: 'tool', content: 'read_file /repo/src/a.ts' },
            { id: 's1:tool:read_file:3', role: 'tool', content: 'read_file /repo/src/b.ts' },
        ];

        const result = rebuildTranscriptWithCodeBlocks(entries, 80);
        const rendered = result.lines.join('\n');
        expect(rendered).toContain('unique sources');
        expect(result.entryLineRanges).toHaveLength(1);
    });

    it('supports collapsing and expanding grouped context lines', () => {
        const entries: TerminalTranscriptEntry[] = [
            { id: 's1:tool:read_file:1', role: 'tool', content: 'read_file /repo/src/a.ts' },
            { id: 's1:tool:read_file:2', role: 'tool', content: 'read_file /repo/src/b.ts' },
            { id: 's1:tool:read_file:3', role: 'tool', content: 'read_file /repo/src/c.ts' },
        ];

        const collapsed = rebuildTranscriptWithCodeBlocks(entries, 80, {
            shouldCollapseToolEntry: (entryId) => entryId.includes(':context-group:'),
        }).lines.join('\n');
        expect(collapsed).toContain('◈ Gathered context');
        expect(collapsed).not.toContain('read_file /repo/src/a.ts');

        const expanded = rebuildTranscriptWithCodeBlocks(entries, 80, {
            shouldCollapseToolEntry: () => false,
        }).lines.join('\n');
        expect(expanded).toContain('◈ Gathered context');
        expect(expanded).toContain('read_file /repo/src/a.ts');
    });

    it('renders role headers with HH:MM timestamp when provided', () => {
        const ts = new Date('2026-03-18T14:32:00').getTime();
        const entries: TerminalTranscriptEntry[] = [
            { id: 'u1', role: 'user', content: '你好', timestamp: ts },
            { id: 'a1', role: 'assistant', content: '收到', timestamp: ts },
        ];
        const rendered = rebuildTranscriptWithCodeBlocks(entries, 80).lines.join('\n');
        expect(rendered).toContain('you  14:32');
        expect(rendered).toContain('xqoder  14:32');
    });

    it('formats large tool output as line and size summary detail', () => {
        const content = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n');
        const entries: TerminalTranscriptEntry[] = [
            { id: 's1:tool:read_file:1', role: 'tool', content, success: true },
        ];
        const rendered = rebuildTranscriptWithCodeBlocks(entries, 80).lines.join('\n');
        expect(rendered).toContain('→ Completed read_file');
        expect(rendered).toContain('↳ 12 lines');
        expect(rendered).toContain('KB');
    });
});
