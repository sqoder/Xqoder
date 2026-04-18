import { describe, expect, it } from 'bun:test';
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
});
