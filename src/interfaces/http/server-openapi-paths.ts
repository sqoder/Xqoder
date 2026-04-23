// XQoder HTTP Server — OpenAPI path helpers
// =============================================

export function createOpenApiPaths() {
    return {
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
                summary: 'Server-sent ConversationEventEnvelope stream',
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
                                                usage: {
                                                    promptTokens: 120,
                                                    completionTokens: 32,
                                                    totalTokens: 152,
                                                },
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
                summary: 'Get session detail',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
                ],
                responses: {
                    200: {
                        description: 'Session detail with usage, transcript, and conversation signals',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SessionDetailResponse' },
                                examples: {
                                    detail: {
                                        value: {
                                            id: 'session_123',
                                            projectRoot: '/workspace/demo',
                                            cwd: '/workspace/demo',
                                            model: 'openai/gpt-4o',
                                            title: 'Debug checkout flow',
                                            createdAt: '2026-03-14T08:00:00.000Z',
                                            updatedAt: '2026-03-14T08:05:00.000Z',
                                            messageCount: 4,
                                            usage: {
                                                promptTokens: 120,
                                                completionTokens: 32,
                                                totalTokens: 152,
                                            },
                                            transcript: [
                                                { role: 'system', content: 'system' },
                                                { role: 'user', content: 'inspect this session' },
                                                { role: 'tool', content: 'patched payload', toolCallId: 'tool_1' },
                                                { role: 'system', content: 'Verification passed: detail payload includes transcript signals' },
                                                { role: 'assistant', content: 'session detail is now visible over HTTP' },
                                            ],
                                            conversationSignals: [
                                                { type: 'user', content: 'inspect this session' },
                                                {
                                                    type: 'tool',
                                                    content: 'patched payload',
                                                    toolCallId: 'tool_1',
                                                    toolName: 'write_file',
                                                    success: true,
                                                },
                                                {
                                                    type: 'verification',
                                                    content: 'Verification passed: detail payload includes transcript signals',
                                                    ok: true,
                                                    blocked: false,
                                                    summary: 'Verification passed: detail payload includes transcript signals',
                                                },
                                                { type: 'assistant', content: 'session detail is now visible over HTTP' },
                                            ],
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
                        description: 'Session transcript messages with derived conversation signals',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SessionMessagesResponse' },
                                examples: {
                                    transcript: {
                                        value: {
                                            messages: [
                                                { role: 'system', content: 'system' },
                                                { role: 'user', content: 'inspect this session' },
                                                { role: 'tool', content: 'patched payload', toolCallId: 'tool_1' },
                                                { role: 'system', content: 'Verification passed: detail payload includes transcript signals' },
                                                { role: 'assistant', content: 'session detail is now visible over HTTP' },
                                            ],
                                            conversationSignals: [
                                                { type: 'user', content: 'inspect this session' },
                                                {
                                                    type: 'tool',
                                                    content: 'patched payload',
                                                    toolCallId: 'tool_1',
                                                    toolName: 'write_file',
                                                    success: true,
                                                },
                                                {
                                                    type: 'verification',
                                                    content: 'Verification passed: detail payload includes transcript signals',
                                                    ok: true,
                                                    blocked: false,
                                                    summary: 'Verification passed: detail payload includes transcript signals',
                                                },
                                                { type: 'assistant', content: 'session detail is now visible over HTTP' },
                                            ],
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
                                examples: {
                                    eventLine: {
                                        summary: 'NDJSON event line with stable conversation envelope',
                                        value: {
                                            type: 'event',
                                            streamId: 'stream_123',
                                            seq: 7,
                                            cursor: 7,
                                            event: {
                                                schemaVersion: 1,
                                                eventId: 'session_123:turn_7:event:7',
                                                sessionId: 'session_123',
                                                turnId: 'session_123:turn_7',
                                                timestamp: '2026-04-22T12:00:00.000Z',
                                                type: 'verification.completed',
                                                payload: {
                                                    source: 'runtime',
                                                    ok: true,
                                                    blocked: false,
                                                    summary: 'Verification passed: stream contract and docs are aligned',
                                                },
                                            },
                                        },
                                    },
                                    terminalEventLine: {
                                        summary: 'NDJSON terminal event line with stopReason in the envelope payload',
                                        value: {
                                            type: 'event',
                                            streamId: 'stream_123',
                                            seq: 8,
                                            cursor: 8,
                                            event: {
                                                schemaVersion: 1,
                                                eventId: 'session_123:turn_7:event:8',
                                                sessionId: 'session_123',
                                                turnId: 'session_123:turn_7',
                                                timestamp: '2026-04-22T12:00:01.000Z',
                                                type: 'status.changed',
                                                payload: {
                                                    source: 'runtime',
                                                    status: 'done',
                                                    stopReason: 'completed',
                                                },
                                            },
                                        },
                                    },
                                    doneLine: {
                                        summary: 'NDJSON done line',
                                        value: {
                                            type: 'done',
                                            streamId: 'stream_123',
                                            seq: 8,
                                            cursor: 8,
                                            response: 'All checks passed.',
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
    };
}
