import { describe, expect, it } from 'bun:test';
import {
    llmProviderRequiresApiKey,
    MISSING_API_KEY_GUIDANCE,
} from '../../../src/application/config/api-key-guidance.js';

describe('MISSING_API_KEY_GUIDANCE', () => {
    it('includes the current auth, config, and env setup paths', () => {
        expect(MISSING_API_KEY_GUIDANCE).toContain('xqoder auth login <provider> --api-key <key>');
        expect(MISSING_API_KEY_GUIDANCE).toContain('xqoder config init --api-key <key>');
        expect(MISSING_API_KEY_GUIDANCE).toContain('XQODER_LLM_API_KEY');
    });

    it('does not require an API key for the local provider', () => {
        expect(llmProviderRequiresApiKey('local')).toBe(false);
        expect(llmProviderRequiresApiKey('groq')).toBe(true);
    });
});
