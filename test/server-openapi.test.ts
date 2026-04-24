import { describe, expect, it } from 'bun:test';
import { createOpenApiComponents } from '../src/interfaces/http/server-openapi-components.js';
import { createOpenApiPaths } from '../src/interfaces/http/server-openapi-paths.js';
import { createOpenApiDocument } from '../src/interfaces/http/server-openapi.js';

describe('server OpenAPI document', () => {
    it('includes the primary docs and search endpoints', () => {
        const doc = createOpenApiDocument('127.0.0.1', 4096);

        expect(doc.openapi).toBe('3.1.0');
        expect(doc.info.title).toBe('XQoder Server API');
        expect(doc.servers[0]?.url).toBe('http://127.0.0.1:4096');
        expect(doc.paths['/doc.openapi.json']).toBeDefined();
        expect(doc.paths['/find']).toBeDefined();
        expect(doc.paths['/find/file']).toBeDefined();
        expect(doc.paths['/find/symbol']).toBeDefined();
        expect(doc.tags?.map((tag) => tag.name)).toContain('docs');
        expect(doc.tags?.map((tag) => tag.name)).toContain('search');
    });

    it('keeps reusable components and session/stream paths available after the split', () => {
        const components = createOpenApiComponents() as Record<string, Record<string, unknown>>;
        const paths = createOpenApiPaths();

        expect(components.securitySchemes?.basicAuth).toEqual({
            type: 'http',
            scheme: 'basic',
        });
        expect(components.responses?.UnauthorizedError).toBeDefined();
        expect(components.schemas?.SessionSummary).toBeDefined();
        expect(components.schemas?.SessionUsage).toBeDefined();
        expect(components.schemas?.ConversationSignal).toBeDefined();
        expect(components.schemas?.SessionDetailResponse).toBeDefined();
        expect(components.schemas?.SessionMessagesResponse).toBeDefined();

        expect(paths['/session']).toBeDefined();
        expect(paths['/session/{id}/message/stream']).toBeDefined();
        expect(paths['/session/{id}/question/{requestId}/resolve']).toBeDefined();
        expect(paths['/session/{id}/approval/{requestId}/resolve']).toBeDefined();
        expect(paths['/doc']).toBeDefined();
        expect(paths['/doc.openapi.json']).toBeDefined();
    });

    it('documents HTTP session detail/read outputs with transcript and conversation signals', () => {
        const paths = createOpenApiPaths() as Record<string, any>;
        const detailSchema = paths['/session/{id}']?.get?.responses?.['200']?.content?.['application/json']?.schema;
        const detailExample = paths['/session/{id}']?.get?.responses?.['200']?.content?.['application/json']?.examples?.detail?.value;
        const messagesSchema = paths['/session/{id}/messages']?.get?.responses?.['200']?.content?.['application/json']?.schema;
        const messagesExample = paths['/session/{id}/messages']?.get?.responses?.['200']?.content?.['application/json']?.examples?.transcript?.value;

        expect(detailSchema).toEqual({ $ref: '#/components/schemas/SessionDetailResponse' });
        expect(Array.isArray(detailExample.transcript)).toBe(true);
        expect(Array.isArray(detailExample.conversationSignals)).toBe(true);
        expect(detailExample.conversationSignals[1]).toMatchObject({
            type: 'tool',
            toolName: 'write_file',
            success: true,
        });
        expect(detailExample.conversationSignals[2]).toMatchObject({
            type: 'verification',
            ok: true,
            blocked: false,
        });

        expect(messagesSchema).toEqual({ $ref: '#/components/schemas/SessionMessagesResponse' });
        expect(Array.isArray(messagesExample.messages)).toBe(true);
        expect(Array.isArray(messagesExample.conversationSignals)).toBe(true);
    });

    it('documents NDJSON stream event records around ConversationEventEnvelope only', () => {
        const components = createOpenApiComponents() as Record<string, Record<string, any>>;
        const paths = createOpenApiPaths() as Record<string, any>;
        const eventSchema = components.schemas?.StreamWireRecordEvent;
        const envelopeSchema = components.schemas?.ConversationEventEnvelope;
        const ndjsonExample = paths['/session/{id}/message/stream']?.post?.responses?.['200']?.content?.['application/x-ndjson']?.examples?.eventLine?.value;
        const terminalExample = paths['/session/{id}/message/stream']?.post?.responses?.['200']?.content?.['application/x-ndjson']?.examples?.terminalEventLine?.value;

        expect(eventSchema?.properties?.event).toEqual({
            $ref: '#/components/schemas/ConversationEventEnvelope',
        });
        expect(eventSchema?.properties?.conversationEvent).toBeUndefined();
        expect(components.schemas?.StopReason).toBeDefined();
        expect(envelopeSchema?.required).toEqual([
            'schemaVersion',
            'eventId',
            'sessionId',
            'turnId',
            'timestamp',
            'type',
            'payload',
        ]);
        expect(ndjsonExample).toMatchObject({
            type: 'event',
        });
        expect(ndjsonExample.conversationEvent).toBeUndefined();
        expect(ndjsonExample.event).toMatchObject({
            schemaVersion: 1,
            type: 'verification.completed',
            payload: {
                summary: 'Verification passed: stream contract and docs are aligned',
            },
        });
        expect(terminalExample).toMatchObject({
            type: 'event',
        });
        expect(terminalExample.conversationEvent).toBeUndefined();
        expect(terminalExample.event).toMatchObject({
            type: 'status.changed',
            payload: {
                stopReason: 'completed',
            },
        });
    });

    it('keeps the public StopReason enum aligned with the conversation-engine contract', () => {
        const components = createOpenApiComponents() as Record<string, Record<string, any>>;
        const stopReasons = components.schemas?.StopReason?.enum as string[] | undefined;

        expect(stopReasons).toEqual([
            'completed',
            'max_turns',
            'max_tool_calls',
            'max_wall_time',
            'duplicate_tool_call',
            'no_progress',
            'user_cancelled',
            'permission_denied',
            'verification_failed',
            'provider_error',
        ]);
        expect(stopReasons).not.toContain('forced_stop');
    });
});
