// XQoder HTTP Server — OpenAPI document helpers
// ============================================================

import { getXQoderVersion } from '../../cli/version.js';

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
        components: {
            securitySchemes: {
                basicAuth: {
                    type: 'http',
                    scheme: 'basic',
                },
            },
            responses: {
                BadRequestError: {
                    description: 'Bad request payload or query parameters',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ErrorResponse' },
                            examples: {
                                missingQuery: {
                                    summary: 'Missing required query parameter',
                                    value: { error: 'Missing query parameter: query' },
                                },
                                invalidBody: {
                                    summary: 'Invalid JSON body',
                                    value: { error: 'Invalid JSON body' },
                                },
                            },
                        },
                    },
                },
                NotFoundError: {
                    description: 'Requested resource was not found',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ErrorResponse' },
                            examples: {
                                sessionNotFound: {
                                    summary: 'Session not found',
                                    value: { error: 'Session not found', id: 'session_123' },
                                },
                                shareNotFound: {
                                    summary: 'Share not found',
                                    value: { error: 'Share not found', id: 'share_123' },
                                },
                            },
                        },
                    },
                },
                ConflictError: {
                    description: 'Conflict while resolving request',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ErrorResponse' },
                            examples: {
                                multipleQuestionRequests: {
                                    summary: 'Multiple pending question requests matched',
                                    value: {
                                        error: 'Multiple pending question requests; specify streamId',
                                        sessionId: 'session_123',
                                        requestId: 'req_123',
                                    },
                                },
                            },
                        },
                    },
                },
                InternalServerError: {
                    description: 'Internal server error',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ErrorResponse' },
                            examples: {
                                messageRunFailed: {
                                    summary: 'Message execution failure',
                                    value: { error: 'Agent execution failed' },
                                },
                            },
                        },
                    },
                },
                ServiceUnavailableError: {
                    description: 'Service dependency not configured',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ErrorResponse' },
                            examples: {
                                storeMissing: {
                                    summary: 'Session store unavailable',
                                    value: { error: 'Session store not configured' },
                                },
                                runtimeMissing: {
                                    summary: 'Message runtime unavailable',
                                    value: { error: 'Server not configured for messages' },
                                },
                            },
                        },
                    },
                },
                UnauthorizedError: {
                    description: 'Missing or invalid Basic auth credentials',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ErrorResponse' },
                            examples: {
                                unauthorized: {
                                    summary: 'Unauthorized request',
                                    value: { error: 'Unauthorized' },
                                },
                            },
                        },
                    },
                },
            },
            schemas: {
                ErrorResponse: {
                    type: 'object',
                    properties: {
                        error: { type: 'string' },
                        path: { type: 'string' },
                    },
                    required: ['error'],
                },
                HealthResponse: {
                    type: 'object',
                    properties: {
                        healthy: { type: 'boolean' },
                        version: { type: 'string' },
                    },
                    required: ['healthy', 'version'],
                },
                ProjectResponse: {
                    type: 'object',
                    properties: {
                        projectRoot: { type: 'string' },
                        cwd: { type: 'string' },
                        platform: { type: 'string' },
                    },
                    required: ['projectRoot', 'cwd', 'platform'],
                },
                FindMatch: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        line: { type: 'number' },
                        text: { type: 'string' },
                    },
                    required: ['path', 'line', 'text'],
                },
                FindResponse: {
                    type: 'object',
                    properties: {
                        query: { type: 'string' },
                        regex: { type: 'boolean' },
                        matches: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/FindMatch' },
                        },
                    },
                    required: ['query', 'regex', 'matches'],
                },
                FindFileResponse: {
                    type: 'object',
                    properties: {
                        query: { type: 'string' },
                        files: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['query', 'files'],
                },
                FileResponse: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        content: { type: 'string' },
                    },
                    required: ['path', 'content'],
                },
                SymbolSearchStrategy: {
                    type: 'object',
                    properties: {
                        lspAttempted: { type: 'boolean' },
                        lspSucceeded: { type: 'boolean' },
                        fallbackScan: { type: 'boolean' },
                    },
                    required: ['lspAttempted', 'lspSucceeded', 'fallbackScan'],
                },
                SymbolPagination: {
                    type: 'object',
                    properties: {
                        cursor: { type: 'string' },
                        nextCursor: { type: 'string' },
                        total: { type: 'number' },
                    },
                    required: ['cursor', 'total'],
                },
                SymbolSearchResponse: {
                    type: 'object',
                    properties: {
                        query: { type: 'string' },
                        kind: { type: 'string' },
                        strategy: { $ref: '#/components/schemas/SymbolSearchStrategy' },
                        pagination: { $ref: '#/components/schemas/SymbolPagination' },
                        symbols: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/SymbolMatch' },
                        },
                    },
                    required: ['query', 'strategy', 'pagination', 'symbols'],
                },
                ProviderEntry: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        current: { type: 'boolean' },
                        authenticated: { type: 'boolean' },
                        disabled: { type: 'boolean' },
                        defaultModel: { type: 'string' },
                        baseUrl: { type: 'string' },
                    },
                    required: ['name', 'current', 'authenticated', 'disabled'],
                },
                ProviderResponse: {
                    type: 'object',
                    properties: {
                        current: { type: 'string' },
                        providers: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/ProviderEntry' },
                        },
                    },
                    required: ['current', 'providers'],
                },
                ConfigResponse: {
                    type: 'object',
                    properties: {
                        config: { type: 'object' },
                        appliedEnvVars: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['config', 'appliedEnvVars'],
                },
                SessionSummary: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        projectRoot: { type: 'string' },
                        cwd: { type: 'string' },
                        model: { type: 'string' },
                        title: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' },
                        messageCount: { type: 'number' },
                    },
                    required: ['id', 'projectRoot', 'cwd', 'model', 'title', 'createdAt', 'updatedAt', 'messageCount'],
                },
                SymbolMatch: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        kind: { type: 'string', enum: ['function', 'class', 'interface', 'type', 'variable'] },
                        path: { type: 'string' },
                        line: { type: 'number' },
                        text: { type: 'string' },
                        source: { type: 'string', enum: ['lsp', 'scan'] },
                    },
                    required: ['name', 'kind', 'path', 'line', 'text', 'source'],
                },
                StreamWireRecordEvent: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', const: 'event' },
                        streamId: { type: 'string' },
                        seq: { type: 'number' },
                        cursor: { type: 'number' },
                        event: { type: 'object' },
                    },
                    required: ['type', 'streamId', 'seq', 'cursor', 'event'],
                },
                StreamWireRecordDone: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', const: 'done' },
                        streamId: { type: 'string' },
                        seq: { type: 'number' },
                        cursor: { type: 'number' },
                        response: { type: 'string' },
                        sessionId: { type: 'string' },
                    },
                    required: ['type', 'streamId', 'seq', 'cursor', 'response', 'sessionId'],
                },
                StreamWireRecordError: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', const: 'error' },
                        streamId: { type: 'string' },
                        seq: { type: 'number' },
                        cursor: { type: 'number' },
                        message: { type: 'string' },
                    },
                    required: ['type', 'streamId', 'seq', 'cursor', 'message'],
                },
                StreamWireRecordCancelled: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', const: 'cancelled' },
                        streamId: { type: 'string' },
                        seq: { type: 'number' },
                        cursor: { type: 'number' },
                        reason: { type: 'string' },
                    },
                    required: ['type', 'streamId', 'seq', 'cursor', 'reason'],
                },
                StreamWireRecord: {
                    oneOf: [
                        { $ref: '#/components/schemas/StreamWireRecordEvent' },
                        { $ref: '#/components/schemas/StreamWireRecordDone' },
                        { $ref: '#/components/schemas/StreamWireRecordError' },
                        { $ref: '#/components/schemas/StreamWireRecordCancelled' },
                    ],
                },
                SessionMessageRequest: {
                    type: 'object',
                    properties: {
                        message: { type: 'string' },
                        attachments: {
                            type: 'array',
                            items: { type: 'object' },
                        },
                    },
                    required: ['message'],
                },
                SessionMessageResponse: {
                    type: 'object',
                    properties: {
                        response: { type: 'string' },
                        sessionId: { type: 'string' },
                    },
                    required: ['response', 'sessionId'],
                },
                SessionListResponse: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/SessionSummary' },
                },
                SessionCreateRequest: {
                    type: 'object',
                    properties: {
                        projectRoot: { type: 'string' },
                        title: { type: 'string' },
                    },
                },
                SessionQuestionResolveRequest: {
                    type: 'object',
                    properties: {
                        selected: {
                            type: 'array',
                            items: { type: 'string' },
                        },
                        customText: { type: 'string' },
                        streamId: { type: 'string', minLength: 1 },
                    },
                },
                SessionQuestionResolveResponse: {
                    type: 'object',
                    properties: {
                        ok: { type: 'boolean' },
                        requestId: { type: 'string' },
                    },
                    required: ['ok'],
                },
                SessionMessagesResponse: {
                    type: 'object',
                    properties: {
                        messages: {
                            type: 'array',
                            items: { type: 'object' },
                        },
                    },
                    required: ['messages'],
                },
                StreamCancelResponse: {
                    type: 'object',
                    properties: {
                        ok: { type: 'boolean' },
                        streamId: { type: 'string' },
                    },
                    required: ['ok', 'streamId'],
                },
                StreamRequestBody: {
                    type: 'object',
                    properties: {
                        message: { type: 'string', minLength: 1 },
                        streamId: { type: 'string', minLength: 1 },
                        cursor: { type: 'integer', minimum: 0 },
                        timeoutMs: { type: 'integer', minimum: 5000, maximum: 600000 },
                        attachments: { type: 'array', items: { type: 'object' } },
                    },
                    anyOf: [
                        { required: ['message'] },
                        { required: ['streamId'] },
                    ],
                },
            },
        },
        paths: {
            '/global/health': {
                get: {
                    operationId: 'getGlobalHealth',
                    tags: ['system'],
                    summary: 'Health check',
                    responses: {
                        200: {
                            description: 'Server is healthy',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/HealthResponse' },
                                    examples: {
                                        healthy: {
                                            value: {
                                                healthy: true,
                                                version: '0.2.0',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                    },
                },
            },
            '/project': {
                get: {
                    operationId: 'getProject',
                    tags: ['system'],
                    summary: 'Project metadata',
                    responses: {
                        200: {
                            description: 'Project root and platform',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ProjectResponse' },
                                    examples: {
                                        projectMeta: {
                                            value: {
                                                projectRoot: '/workspace/demo',
                                                cwd: '/workspace/demo',
                                                platform: 'darwin',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                    },
                },
            },
            '/config': {
                get: {
                    operationId: 'getConfig',
                    tags: ['system'],
                    summary: 'Resolved config snapshot',
                    responses: {
                        200: {
                            description: 'Resolved config with redacted secrets',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ConfigResponse' },
                                    examples: {
                                        resolvedConfig: {
                                            value: {
                                                config: {
                                                    provider: 'openai',
                                                    model: 'gpt-4.1-mini',
                                                    apiKey: '***REDACTED***',
                                                },
                                                appliedEnvVars: ['OPENAI_API_KEY'],
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                    },
                },
            },
            '/provider': {
                get: {
                    operationId: 'getProvider',
                    tags: ['system'],
                    summary: 'Provider readiness state',
                    responses: {
                        200: {
                            description: 'Provider auth and active selection',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ProviderResponse' },
                                    examples: {
                                        providers: {
                                            value: {
                                                current: 'openai',
                                                providers: [
                                                    {
                                                        name: 'openai',
                                                        current: true,
                                                        authenticated: true,
                                                        disabled: false,
                                                        defaultModel: 'gpt-4.1-mini',
                                                        baseUrl: 'https://api.openai.com/v1',
                                                    },
                                                ],
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                    },
                },
            },
            '/event': {
                get: {
                    operationId: 'getEventStream',
                    tags: ['stream'],
                    summary: 'Server-sent AppEvent stream',
                    responses: {
                        200: {
                            description: 'SSE stream',
                            content: {
                                'text/event-stream': {
                                    schema: { type: 'string' },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                    },
                },
            },
            '/find': {
                get: {
                    operationId: 'getFindMatches',
                    tags: ['search'],
                    summary: 'Search text in project files',
                    parameters: [
                        { name: 'query', in: 'query', required: true, schema: { type: 'string' } },
                        { name: 'regex', in: 'query', required: false, schema: { type: 'boolean' } },
                        { name: 'limit', in: 'query', required: false, schema: { type: 'number' } },
                    ],
                    responses: {
                        200: {
                            description: 'File content search results',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/FindResponse' },
                                    examples: {
                                        textMatches: {
                                            value: {
                                                query: 'createServer',
                                                regex: false,
                                                matches: [
                                                    {
                                                        path: 'packages/cli/src/server/index.ts',
                                                        line: 1254,
                                                        text: 'export function createServer(options: ServerOptions = {}): http.Server {',
                                                    },
                                                ],
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                        400: { $ref: '#/components/responses/BadRequestError' },
                    },
                },
            },
            '/find/file': {
                get: {
                    operationId: 'getFindFiles',
                    tags: ['search'],
                    summary: 'Search files by path text',
                    parameters: [
                        { name: 'query', in: 'query', required: true, schema: { type: 'string' } },
                        { name: 'limit', in: 'query', required: false, schema: { type: 'number' } },
                    ],
                    responses: {
                        200: {
                            description: 'Path search results',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/FindFileResponse' },
                                    examples: {
                                        fileMatches: {
                                            value: {
                                                query: 'server/index',
                                                files: ['packages/cli/src/server/index.ts'],
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                        400: { $ref: '#/components/responses/BadRequestError' },
                    },
                },
            },
            '/find/symbol': {
                get: {
                    operationId: 'getFindSymbols',
                    tags: ['search'],
                    summary: 'Search symbols by name/kind',
                    parameters: [
                        { name: 'query', in: 'query', required: true, schema: { type: 'string' } },
                        { name: 'kind', in: 'query', required: false, schema: { type: 'string' } },
                        { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
                        { name: 'limit', in: 'query', required: false, schema: { type: 'number' } },
                    ],
                    responses: {
                        200: {
                            description: 'Symbol search results',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SymbolSearchResponse' },
                                    examples: {
                                        symbols: {
                                            value: {
                                                query: 'createServer',
                                                strategy: {
                                                    lspAttempted: true,
                                                    lspSucceeded: true,
                                                    fallbackScan: false,
                                                },
                                                pagination: {
                                                    cursor: '0',
                                                    total: 1,
                                                },
                                                symbols: [
                                                    {
                                                        name: 'createServer',
                                                        kind: 'function',
                                                        path: 'packages/cli/src/server/index.ts',
                                                        line: 1254,
                                                        text: 'export function createServer(...)',
                                                        source: 'lsp',
                                                    },
                                                ],
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                        400: { $ref: '#/components/responses/BadRequestError' },
                    },
                },
            },
            '/file': {
                get: {
                    operationId: 'getFile',
                    tags: ['search'],
                    summary: 'Read a project file',
                    parameters: [
                        { name: 'path', in: 'query', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: {
                            description: 'File text payload',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/FileResponse' },
                                    examples: {
                                        fileContent: {
                                            value: {
                                                path: 'README.md',
                                                content: '# XQoder\n',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                        400: { $ref: '#/components/responses/BadRequestError' },
                        403: {
                            description: 'Path escapes project root',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                    examples: {
                                        escapedPath: {
                                            value: { error: 'Path escapes project root' },
                                        },
                                    },
                                },
                            },
                        },
                        404: { $ref: '#/components/responses/NotFoundError' },
                    },
                },
            },
            '/share/{id}': {
                get: {
                    operationId: 'getShareById',
                    tags: ['share'],
                    summary: 'Read shared session artifact by id',
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: {
                            description: 'Share payload (JSON or markdown)',
                            content: {
                                'application/json': {
                                    schema: { type: 'object' },
                                    examples: {
                                        jsonShare: {
                                            value: { hello: 'world' },
                                        },
                                    },
                                },
                                'text/markdown': {
                                    schema: { type: 'string' },
                                    examples: {
                                        markdownShare: {
                                            value: '# shared\n',
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                        404: { $ref: '#/components/responses/NotFoundError' },
                        503: { $ref: '#/components/responses/ServiceUnavailableError' },
                    },
                },
            },
            '/session': {
                get: {
                    operationId: 'listSessions',
                    tags: ['session'],
                    summary: 'List sessions',
                    parameters: [
                        { name: 'projectRoot', in: 'query', required: false, schema: { type: 'string' } },
                        { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } },
                    ],
                    responses: {
                        200: {
                            description: 'Session summaries',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SessionListResponse' },
                                    examples: {
                                        list: {
                                            value: [
                                                {
                                                    id: 'session_123',
                                                    projectRoot: '/workspace/demo',
                                                    cwd: '/workspace/demo',
                                                    model: 'openai/gpt-4o',
                                                    title: 'Debug checkout flow',
                                                    createdAt: '2026-03-14T08:00:00.000Z',
                                                    updatedAt: '2026-03-14T08:05:00.000Z',
                                                    messageCount: 4,
                                                },
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                        503: { $ref: '#/components/responses/ServiceUnavailableError' },
                    },
                },
                post: {
                    operationId: 'createSession',
                    tags: ['session'],
                    summary: 'Create session',
                    requestBody: {
                        required: false,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SessionCreateRequest' },
                                examples: {
                                    minimal: {
                                        summary: 'Create session in current cwd',
                                        value: {},
                                    },
                                    withProjectAndTitle: {
                                        summary: 'Create session with explicit project root and title',
                                        value: {
                                            projectRoot: '/workspace/demo',
                                            title: 'Debug checkout flow',
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'Created session summary',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SessionSummary' },
                                    examples: {
                                        created: {
                                            value: {
                                                id: 'session_123',
                                                projectRoot: '/workspace/demo',
                                                cwd: '/workspace/demo',
                                                model: 'openai/gpt-4o',
                                                title: 'New Session',
                                                createdAt: '2026-03-14T08:00:00.000Z',
                                                updatedAt: '2026-03-14T08:00:00.000Z',
                                                messageCount: 0,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                        400: { $ref: '#/components/responses/BadRequestError' },
                        503: { $ref: '#/components/responses/ServiceUnavailableError' },
                    },
                },
            },
            '/session/{id}': {
                get: {
                    operationId: 'getSessionById',
                    tags: ['session'],
                    summary: 'Get session summary',
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
                    ],
                    responses: {
                        200: {
                            description: 'Session summary',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SessionSummary' },
                                    examples: {
                                        summary: {
                                            value: {
                                                id: 'session_123',
                                                projectRoot: '/workspace/demo',
                                                cwd: '/workspace/demo',
                                                model: 'openai/gpt-4o',
                                                title: 'Debug checkout flow',
                                                createdAt: '2026-03-14T08:00:00.000Z',
                                                updatedAt: '2026-03-14T08:05:00.000Z',
                                                messageCount: 4,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                        404: { $ref: '#/components/responses/NotFoundError' },
                        503: { $ref: '#/components/responses/ServiceUnavailableError' },
                    },
                },
            },
            '/session/{id}/messages': {
                get: {
                    operationId: 'getSessionMessages',
                    tags: ['session'],
                    summary: 'Get session transcript',
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
                    ],
                    responses: {
                        200: {
                            description: 'Session transcript messages',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SessionMessagesResponse' },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                        404: { $ref: '#/components/responses/NotFoundError' },
                        503: { $ref: '#/components/responses/ServiceUnavailableError' },
                    },
                },
            },
            '/session/{id}/message': {
                post: {
                    operationId: 'postSessionMessage',
                    tags: ['session'],
                    summary: 'Send one message',
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SessionMessageRequest' },
                                examples: {
                                    textOnly: {
                                        summary: 'Simple message',
                                        value: {
                                            message: 'Explain this repository structure.',
                                        },
                                    },
                                    withAttachment: {
                                        summary: 'Message with file attachment',
                                        value: {
                                            message: 'Summarize this file.',
                                            attachments: [
                                                {
                                                    type: 'file',
                                                    path: 'README.md',
                                                },
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'Model reply payload',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SessionMessageResponse' },
                                    examples: {
                                        reply: {
                                            value: {
                                                response: 'I analyzed the repo structure and key modules.',
                                                sessionId: 'session_123',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                        400: { $ref: '#/components/responses/BadRequestError' },
                        404: { $ref: '#/components/responses/NotFoundError' },
                        500: { $ref: '#/components/responses/InternalServerError' },
                        503: { $ref: '#/components/responses/ServiceUnavailableError' },
                    },
                },
            },
            '/session/{id}/message/stream': {
                post: {
                    operationId: 'postSessionMessageStream',
                    tags: ['session', 'stream'],
                    summary: 'Send message with NDJSON stream',
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/StreamRequestBody' },
                                examples: {
                                    startStream: {
                                        summary: 'Start a new stream',
                                        value: {
                                            message: 'Refactor this module and explain changes.',
                                            timeoutMs: 120000,
                                        },
                                    },
                                    resumeStream: {
                                        summary: 'Resume from stream cursor',
                                        value: {
                                            streamId: 'stream_123',
                                            cursor: 42,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'NDJSON stream where each line is a StreamWireRecord JSON object',
                            content: {
                                'application/x-ndjson': {
                                    schema: { $ref: '#/components/schemas/StreamWireRecord' },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                        400: { $ref: '#/components/responses/BadRequestError' },
                        404: { $ref: '#/components/responses/NotFoundError' },
                        503: { $ref: '#/components/responses/ServiceUnavailableError' },
                    },
                },
            },
            '/session/{id}/question/{requestId}/resolve': {
                post: {
                    operationId: 'resolveSessionQuestion',
                    tags: ['stream'],
                    summary: 'Resolve pending question',
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
                        { name: 'requestId', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SessionQuestionResolveRequest' },
                                examples: {
                                    selectOption: {
                                        summary: 'Select predefined option(s)',
                                        value: {
                                            selected: ['Yes, continue'],
                                        },
                                    },
                                    selectWithCustomText: {
                                        summary: 'Select option with extra custom text',
                                        value: {
                                            selected: ['Type your own answer'],
                                            customText: 'Please proceed but skip formatting.',
                                            streamId: 'stream_123',
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'Question resolved',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SessionQuestionResolveResponse' },
                                    examples: {
                                        resolved: {
                                            value: {
                                                ok: true,
                                                requestId: 'req_123',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                        400: { $ref: '#/components/responses/BadRequestError' },
                        404: { $ref: '#/components/responses/NotFoundError' },
                        409: { $ref: '#/components/responses/ConflictError' },
                    },
                },
            },
            '/session/{id}/stream/{streamId}/cancel': {
                post: {
                    operationId: 'cancelSessionStream',
                    tags: ['stream'],
                    summary: 'Cancel running stream',
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
                        { name: 'streamId', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
                    ],
                    responses: {
                        200: {
                            description: 'Stream cancelled',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/StreamCancelResponse' },
                                    examples: {
                                        cancelled: {
                                            value: {
                                                ok: true,
                                                streamId: 'stream_123',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                        404: { $ref: '#/components/responses/NotFoundError' },
                    },
                },
            },
            '/doc': {
                get: {
                    operationId: 'getDoc',
                    tags: ['docs'],
                    summary: 'API documentation (HTML or OpenAPI JSON)',
                    responses: {
                        200: {
                            description: 'API documentation in HTML or OpenAPI JSON',
                            content: {
                                'text/html': {
                                    schema: { type: 'string' },
                                },
                                'application/json': {
                                    schema: { type: 'object' },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                    },
                },
            },
            '/doc.openapi.json': {
                get: {
                    operationId: 'getOpenApiDocument',
                    tags: ['docs'],
                    summary: 'OpenAPI JSON document',
                    responses: {
                        200: {
                            description: 'OpenAPI JSON document',
                            content: {
                                'application/json': {
                                    schema: { type: 'object' },
                                },
                            },
                        },
                        401: { $ref: '#/components/responses/UnauthorizedError' },
                    },
                },
            },
        },
    };
}
