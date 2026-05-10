import { describe, expect, it } from 'bun:test';
import {
    handleElicitation,
    type ElicitationAsk,
    type ElicitationRequest,
    type ElicitationResponse,
} from '../../src/core/agent/mcp-elicitation.js';

const baseRequest: ElicitationRequest = {
    title: 'Login required',
    schema: {
        fields: [
            { key: 'username', type: 'string', required: true },
            { key: 'remember', type: 'boolean' },
        ],
    },
};

describe('handleElicitation', () => {
    it('returns cancel when ask is undefined', async () => {
        const response = await handleElicitation(baseRequest, undefined);
        expect(response).toEqual({ action: 'cancel' });
    });

    it('returns cancel when ask resolves to null', async () => {
        const ask: ElicitationAsk = async () => null;
        const response = await handleElicitation(baseRequest, ask);
        expect(response).toEqual({ action: 'cancel' });
    });

    it('accepts and forwards data when ask provides all required fields', async () => {
        const ask: ElicitationAsk = async () => ({
            action: 'accept',
            data: { username: 'alice', remember: true },
        } satisfies ElicitationResponse);
        const response = await handleElicitation(baseRequest, ask);
        expect(response.action).toBe('accept');
        expect(response.data).toEqual({ username: 'alice', remember: true });
    });

    it('returns cancel when a required field is missing', async () => {
        const ask: ElicitationAsk = async () => ({
            action: 'accept',
            data: { remember: true },
        } satisfies ElicitationResponse);
        const response = await handleElicitation(baseRequest, ask);
        expect(response).toEqual({ action: 'cancel' });
    });

    it('returns cancel when ask exceeds the timeout', async () => {
        const ask: ElicitationAsk = () => new Promise(() => {
            /* never resolves */
        });
        const response = await handleElicitation(baseRequest, ask, { timeoutMs: 50 });
        expect(response).toEqual({ action: 'cancel' });
    });

    it('treats explicit cancel action from ask as cancel', async () => {
        const ask: ElicitationAsk = async () => ({ action: 'cancel' } satisfies ElicitationResponse);
        const response = await handleElicitation(baseRequest, ask);
        expect(response).toEqual({ action: 'cancel' });
    });
});
