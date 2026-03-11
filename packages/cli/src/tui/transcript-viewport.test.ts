import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './message.js';
import { alignTranscriptToBottom, buildMessageBlockLines, buildTranscriptLines, sliceTranscriptLines } from './transcript-viewport.js';

describe('transcript viewport', () => {
    it('renders assistant and user messages into transcript lines', () => {
        const messages: ChatMessage[] = [
            { id: '1', type: 'user', content: 'hello' },
            { id: '2', type: 'assistant', content: '```ts\nconst x = 1\n```' },
        ];

        const lines = buildTranscriptLines(messages, 80);

        expect(lines.some(line => line.includes('You'))).toBe(true);
        expect(lines.some(line => line.includes('XQoder'))).toBe(true);
        expect(lines.some(line => line.includes('const x = 1'))).toBe(true);
        expect(lines.some(line => line.includes('  hello'))).toBe(true);
    });

    it('builds tool blocks with a header and indented body', () => {
        expect(buildMessageBlockLines({
            id: 'tool-1',
            type: 'tool',
            toolName: 'Bash',
            toolSuccess: false,
            content: 'git status\npermission denied',
        }, 40)).toEqual([
            'Tool: Bash (failed)',
            '  git status',
            '  permission denied',
        ]);
    });

    it('renders attachment chips under user messages', () => {
        expect(buildMessageBlockLines({
            id: 'user-1',
            type: 'user',
            content: 'please review',
            attachments: ['/tmp/readme.md', '/tmp/model-config.ts'],
        }, 40)).toEqual([
            'You',
            '  please review',
            '  [readme.md] [model-c...]',
        ]);
    });

    it('slices transcript lines with top and bottom overflow indicators', () => {
        const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
        const slice = sliceTranscriptLines(lines, 5, 8);

        expect(slice.showAbove).toBe(true);
        expect(slice.showBelow).toBe(true);
        expect(slice.visible[0]).toBe('line 6');
        expect(slice.visible.at(-1)).toBe('line 13');
    });

    it('pads short transcripts so the latest messages sit above the editor', () => {
        expect(alignTranscriptToBottom(['line 1', 'line 2'], 5)).toEqual([
            '',
            '',
            '',
            'line 1',
            'line 2',
        ]);
    });
});
