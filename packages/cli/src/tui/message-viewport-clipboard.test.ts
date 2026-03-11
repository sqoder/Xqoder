import { describe, expect, it } from 'vitest';
import { copyTranscriptSelectionToClipboard } from './message-viewport-clipboard.js';

describe('message viewport clipboard', () => {
    it('returns false when no clipboard command is available in this environment', () => {
        if (process.platform === 'darwin' || process.env.DISPLAY) {
            expect(typeof copyTranscriptSelectionToClipboard('hello')).toBe('boolean');
            return;
        }

        expect(copyTranscriptSelectionToClipboard('hello')).toBe(false);
    });
});
