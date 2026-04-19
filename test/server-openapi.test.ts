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

        expect(paths['/session']).toBeDefined();
        expect(paths['/session/{id}/message/stream']).toBeDefined();
        expect(paths['/session/{id}/question/{requestId}/resolve']).toBeDefined();
        expect(paths['/doc']).toBeDefined();
        expect(paths['/doc.openapi.json']).toBeDefined();
    });
});
