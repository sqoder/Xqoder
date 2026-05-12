import { describe, expect, it } from 'bun:test';
import { buildConversationTranscript } from '../../src/domain/conversation/messages.js';

describe('conversation transcript projection', () => {
    it('preserves user / assistant / tool / verification signals from session artifacts', () => {
        const transcript = buildConversationTranscript({
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'fix the failing test' },
                { role: 'tool', toolCallId: 'tool-1', content: 'Applied patch to src/foo.ts' },
                { role: 'system', content: 'Verification passed: tests are green' },
                { role: 'assistant', content: 'The test is fixed now.' },
            ],
            toolHistory: [{
                id: 'tool-1',
                name: 'write_file',
                success: true,
            }],
            verificationHistory: [{
                id: 'verification-1',
                ok: true,
                blocked: false,
                summary: 'Verification passed: tests are green',
                messages: ['Verification passed: tests are green'],
            }],
        });

        expect(transcript).toEqual([
            {
                type: 'user',
                content: 'fix the failing test',
            },
            {
                type: 'tool',
                content: 'Applied patch to src/foo.ts',
                toolCallId: 'tool-1',
                toolName: 'write_file',
                success: true,
            },
            {
                type: 'verification',
                content: 'Verification passed: tests are green',
                ok: true,
                blocked: false,
                summary: 'Verification passed: tests are green',
            },
            {
                type: 'assistant',
                content: 'The test is fixed now.',
                response: 'The test is fixed now.',
            },
        ]);
    });
});