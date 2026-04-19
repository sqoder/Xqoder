import { describe, expect, it } from 'bun:test';
import { MISSING_API_KEY_GUIDANCE } from '../../../src/application/config/api-key-guidance.js';

describe('MISSING_API_KEY_GUIDANCE', () => {
    it('includes the current auth, config, and env setup paths', () => {
        expect(MISSING_API_KEY_GUIDANCE).toContain('xqoder auth login <provider> --api-key <key>');
        expect(MISSING_API_KEY_GUIDANCE).toContain('xqoder config init --api-key <key>');
        expect(MISSING_API_KEY_GUIDANCE).toContain('XQODER_LLM_API_KEY');
    });
});
