// XQoder HTTP Server — OpenAPI document helpers
// ============================================================

import { getXQoderVersion } from '../../cli/version.js';
import { createOpenApiComponents } from './server-openapi-components.js';
import { createOpenApiPaths } from './server-openapi-paths.js';

interface OpenApiDocument {
    openapi: string;
    info: { title: string; version: string };
    servers: Array<{
        url: string;
        description?: string;
        variables?: Record<string, { default: string; description?: string }>;
    }>;
    security?: Array<Record<string, string[]>>;
    tags?: Array<{ name: string; description?: string }>;
    paths: Record<string, unknown>;
    components?: Record<string, unknown>;
}

export function createOpenApiDocument(hostname: string, port: number): OpenApiDocument {
    return {
        openapi: '3.1.0',
        info: {
            title: 'XQoder Server API',
            version: getXQoderVersion(),
        },
        servers: [
            {
                url: `http://${hostname}:${port}`,
                description: 'Current serve runtime endpoint',
            },
            {
                url: 'http://{host}:{port}',
                description: 'Parameterized deployment endpoint',
                variables: {
                    host: {
                        default: hostname,
                        description: 'Serve hostname',
                    },
                    port: {
                        default: String(port),
                        description: 'Serve port',
                    },
                },
            },
        ],
        security: [{ basicAuth: [] }],
        tags: [
            { name: 'system', description: 'Server health and project metadata' },
            { name: 'search', description: 'File and symbol search APIs' },
            { name: 'session', description: 'Session lifecycle and messaging APIs' },
            { name: 'stream', description: 'Streaming and interaction control APIs' },
            { name: 'share', description: 'Session share artifact APIs' },
            { name: 'docs', description: 'API documentation endpoints' },
        ],
        components: createOpenApiComponents(),
        paths: createOpenApiPaths(),
    };
}
