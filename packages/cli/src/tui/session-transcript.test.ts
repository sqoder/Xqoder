import { describe, expect, it } from 'vitest';
import type { LLMMessage } from '@xqoder/shared';
import { restoreChatMessagesFromSession } from './session-transcript.js';

describe('session transcript restore', () => {
    it('restores user and assistant chat messages from a persisted session', () => {
        const restored = restoreChatMessagesFromSession([
            {
                role: 'system',
                content: 'hidden system prompt',
            },
            {
                role: 'user',
                content: 'hello',
                attachments: [{
                    type: 'file',
                    mimeType: 'application/octet-stream',
                    filePath: '/tmp/readme.md',
                }],
            },
            {
                role: 'assistant',
                content: 'hi there',
            },
        ] satisfies LLMMessage[]);

        expect(restored).toEqual([
            {
                id: 'restored-user-1',
                type: 'user',
                content: 'hello',
                attachments: ['/tmp/readme.md'],
            },
            {
                id: 'restored-assistant-2',
                type: 'assistant',
                content: 'hi there',
            },
        ]);
    });

    it('falls back to tool call summaries when assistant content is empty', () => {
        expect(restoreChatMessagesFromSession([
            {
                role: 'assistant',
                content: '',
                toolCalls: [{
                    id: 'tool-1',
                    name: 'Read',
                    arguments: '{}',
                }],
            },
        ])).toEqual([
            {
                id: 'restored-assistant-0',
                type: 'assistant',
                content: 'tool: Read',
            },
        ]);
    });
});
