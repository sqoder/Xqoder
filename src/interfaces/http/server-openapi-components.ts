// XQoder HTTP Server — OpenAPI components helpers
// ==================================================

export function createOpenApiComponents() {
    return {
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
            SessionUsage: {
                type: 'object',
                properties: {
                    promptTokens: { type: 'number' },
                    completionTokens: { type: 'number' },
                    totalTokens: { type: 'number' },
                    cacheReadTokens: { type: 'number' },
                    cacheCreationTokens: { type: 'number' },
                    cost: { type: 'number' },
                },
                required: ['promptTokens', 'completionTokens', 'totalTokens'],
            },
            SessionTranscriptMessage: {
                type: 'object',
                properties: {
                    role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
                    content: { type: 'string' },
                    toolCallId: { type: 'string' },
                },
                required: ['role', 'content'],
            },
            ConversationSignal: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['user', 'assistant', 'tool', 'verification'] },
                    content: { type: 'string' },
                    toolCallId: { type: 'string' },
                    toolName: { type: 'string' },
                    success: { type: 'boolean' },
                    ok: { type: 'boolean' },
                    blocked: { type: 'boolean' },
                    summary: { type: 'string' },
                },
                required: ['type', 'content'],
            },
            StopReason: {
                type: 'string',
                enum: [
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
                ],
            },
            ConversationEventEnvelope: {
                type: 'object',
                properties: {
                    schemaVersion: { type: 'number', const: 1 },
                    eventId: { type: 'string' },
                    sessionId: { type: 'string' },
                    turnId: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    type: {
                        type: 'string',
                        enum: [
                            'session.started',
                            'session.resumed',
                            'message.started',
                            'message.delta',
                            'message.completed',
                            'tool.called',
                            'tool.output',
                            'tool.completed',
                            'approval.requested',
                            'approval.resolved',
                            'question.requested',
                            'question.resolved',
                            'status.changed',
                            'thought',
                            'usage',
                            'verification.completed',
                            'error',
                        ],
                    },
                    payload: {
                        type: 'object',
                        description: 'Stable event payload. Terminal status/error payloads may include stopReason and message.',
                        additionalProperties: true,
                    },
                },
                required: ['schemaVersion', 'eventId', 'sessionId', 'turnId', 'timestamp', 'type', 'payload'],
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
                    usage: { $ref: '#/components/schemas/SessionUsage' },
                },
                required: ['id', 'projectRoot', 'cwd', 'model', 'title', 'createdAt', 'updatedAt', 'messageCount'],
            },
            SessionDetailResponse: {
                allOf: [
                    { $ref: '#/components/schemas/SessionSummary' },
                    {
                        type: 'object',
                        properties: {
                            transcript: {
                                type: 'array',
                                items: { $ref: '#/components/schemas/SessionTranscriptMessage' },
                            },
                            conversationSignals: {
                                type: 'array',
                                items: { $ref: '#/components/schemas/ConversationSignal' },
                            },
                        },
                        required: ['transcript', 'conversationSignals'],
                    },
                ],
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
                    event: { $ref: '#/components/schemas/ConversationEventEnvelope' },
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
                        items: { $ref: '#/components/schemas/SessionTranscriptMessage' },
                    },
                    conversationSignals: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/ConversationSignal' },
                    },
                },
                required: ['messages', 'conversationSignals'],
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
    };
}
