// ============================================================
// XQoder HTTP Server — OpenCode 风格 API（session + message）
// ============================================================

import * as http from 'node:http';
import * as url from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getXQoderVersion } from '../version.js';
import {
    ExternalLanguageServerManager,
    type AgentSessionStore,
    type WorkspaceSymbolMatch,
} from '@xqoder/agent';
import {
    configManager,
    resolveConfigWithEnvOverrides,
    SUPPORTED_LLM_PROVIDERS,
    type MessageAttachment,
} from '@xqoder/shared';
import type { AppEvent } from '@xqoder/protocol';
import type { QuestionAnswer, QuestionPrompt } from '@xqoder/plugin-sdk';
import type { SessionShareStore } from '../session-assets.js';

export interface ServerOptions {
    port?: number;
    hostname?: string;
    cors?: string[];
    password?: string;
    username?: string;
    /** 项目根目录（serve 时的 cwd） */
    cwd?: string;
    /** 默认模型（创建新 session 时用） */
    defaultModel?: string;
    sessionStore?: AgentSessionStore;
    shareStore?: SessionShareStore;
    /** 在指定 session 上跑一条消息，返回回复与 sessionId */
    runMessage?: (params: {
        projectRoot: string;
        sessionId: string;
        message: string;
        attachments?: MessageAttachment[];
    }) => Promise<{ response: string; sessionId: string }>;
    runMessageStream?: (params: {
        projectRoot: string;
        sessionId: string;
        message: string;
        attachments?: MessageAttachment[];
        onEvent: (event: AppEvent) => void;
        requestQuestion: (prompt: QuestionPrompt) => Promise<QuestionAnswer>;
        signal?: AbortSignal;
    }) => Promise<{ response: string; sessionId: string }>;
}

interface PendingQuestionEntry {
    sessionId: string;
    streamId: string;
    requestId: string;
    fallbackSelected: string[];
    resolve: (answer: QuestionAnswer) => void;
    timeout: NodeJS.Timeout;
}

type StreamWireRecord =
    | { type: 'event'; streamId: string; seq: number; cursor: number; event: AppEvent }
    | { type: 'done'; streamId: string; seq: number; cursor: number; response: string; sessionId: string }
    | { type: 'error'; streamId: string; seq: number; cursor: number; message: string }
    | { type: 'cancelled'; streamId: string; seq: number; cursor: number; reason: string };

type StreamAppendRecord =
    | { type: 'event'; event: AppEvent }
    | { type: 'done'; response: string; sessionId: string }
    | { type: 'error'; message: string }
    | { type: 'cancelled'; reason: string };

interface StreamSubscriber {
    id: string;
    res: http.ServerResponse;
    lastSeq: number;
}

interface StreamOperation {
    id: string;
    sessionId: string;
    projectRoot: string;
    message: string;
    attachments?: MessageAttachment[];
    createdAt: number;
    nextSeq: number;
    records: StreamWireRecord[];
    subscribers: Map<string, StreamSubscriber>;
    completed: boolean;
    abortController: AbortController;
    timeout: NodeJS.Timeout;
    gcTimer?: NodeJS.Timeout;
}

interface StreamRequestBody {
    message?: string;
    attachments?: MessageAttachment[];
    streamId?: string;
    cursor?: number;
    timeoutMs?: number;
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

function jsonResponse(res: http.ServerResponse, status: number, data: unknown, corsHeaders: Record<string, string>): void {
    res.writeHead(status, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function resolvePathWithinRoot(projectRoot: string, inputPath: string): string | null {
    const root = path.resolve(projectRoot);
    const resolved = path.resolve(root, inputPath);
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
        return resolved;
    }
    return null;
}

function listProjectFiles(root: string, limit = 1000): string[] {
    const skipped = new Set(['.git', 'node_modules', '.xqoder']);
    const queue = [root];
    const files: string[] = [];

    while (queue.length > 0 && files.length < limit) {
        const current = queue.shift();
        if (!current) {
            break;
        }
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (files.length >= limit) {
                break;
            }
            if (skipped.has(entry.name)) {
                continue;
            }
            const absolute = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(absolute);
                continue;
            }
            if (entry.isFile()) {
                files.push(absolute);
            }
        }
    }

    return files;
}

function readTextFileSafe(filePath: string, maxBytes = 1024 * 1024): string {
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes) {
        throw new Error(`File too large (${stat.size} bytes, max ${maxBytes})`);
    }
    return fs.readFileSync(filePath, 'utf-8');
}

type ProjectSymbolKind = 'function' | 'class' | 'interface' | 'type' | 'variable';

interface ProjectSymbolMatch {
    name: string;
    kind: ProjectSymbolKind;
    path: string;
    line: number;
    text: string;
}

interface ResolvedSymbolMatch extends ProjectSymbolMatch {
    source: 'lsp' | 'scan';
}

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

interface ScoredSymbolMatch {
    score: number;
    value: ResolvedSymbolMatch;
}

interface SymbolCursorPayload {
    query: string;
    kind?: string;
    offset: number;
}

function detectSymbolInLine(line: string): { name: string; kind: ProjectSymbolKind } | null {
    const trimmed = line.trim();
    if (!trimmed) {
        return null;
    }

    const functionMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/);
    if (functionMatch?.[1]) {
        return { name: functionMatch[1], kind: 'function' };
    }
    const classMatch = trimmed.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
    if (classMatch?.[1]) {
        return { name: classMatch[1], kind: 'class' };
    }
    const interfaceMatch = trimmed.match(/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/);
    if (interfaceMatch?.[1]) {
        return { name: interfaceMatch[1], kind: 'interface' };
    }
    const typeMatch = trimmed.match(/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/);
    if (typeMatch?.[1]) {
        return { name: typeMatch[1], kind: 'type' };
    }
    const variableMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/);
    if (variableMatch?.[1]) {
        return { name: variableMatch[1], kind: 'variable' };
    }
    const pythonFunctionMatch = trimmed.match(/^def\s+([A-Za-z_][\w]*)\s*\(/);
    if (pythonFunctionMatch?.[1]) {
        return { name: pythonFunctionMatch[1], kind: 'function' };
    }
    const pythonClassMatch = trimmed.match(/^class\s+([A-Za-z_][\w]*)\b/);
    if (pythonClassMatch?.[1]) {
        return { name: pythonClassMatch[1], kind: 'class' };
    }

    return null;
}

function normalizeLspSymbolKind(kind: string): ProjectSymbolKind | null {
    const normalized = String(kind).trim().toLowerCase();
    switch (normalized) {
        case '5':
        case 'class':
            return 'class';
        case '12':
        case 'function':
        case 'method':
        case '3':
        case '6':
            return 'function';
        case '11':
        case 'interface':
            return 'interface';
        case '13':
        case '14':
        case 'variable':
        case 'constant':
            return 'variable';
        case '26':
        case 'type':
        case 'typeparameter':
        case '23':
        case 'struct':
            return 'type';
        default:
            return null;
    }
}

function toResolvedLspSymbolMatch(
    match: WorkspaceSymbolMatch,
    projectRoot: string,
): ResolvedSymbolMatch | null {
    const kind = normalizeLspSymbolKind(match.kind);
    if (!kind) {
        return null;
    }
    return {
        name: match.name,
        kind,
        path: path.relative(projectRoot, match.filePath),
        line: match.line,
        text: match.preview,
        source: 'lsp',
    };
}

function createOpenApiDocument(hostname: string, port: number): OpenApiDocument {
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

function isDuplicateStatusEvent(op: StreamOperation, event: AppEvent): boolean {
    if (event.type !== 'status.changed') {
        return false;
    }
    const latest = op.records[op.records.length - 1];
    if (!latest || latest.type !== 'event' || latest.event.type !== 'status.changed') {
        return false;
    }
    return latest.event.sessionId === event.sessionId && latest.event.status === event.status;
}

function scoreSymbolMatch(query: string, symbol: ResolvedSymbolMatch): number {
    const name = symbol.name.toLowerCase();
    const loweredQuery = query.toLowerCase();
    let score = 0;

    if (name === loweredQuery) {
        score += 100;
    } else if (name.startsWith(loweredQuery)) {
        score += 70;
    } else if (name.includes(loweredQuery)) {
        score += 40;
    }

    if (symbol.source === 'lsp') {
        score += 20;
    }

    if (symbol.path.toLowerCase().includes(loweredQuery)) {
        score += 5;
    }

    return score;
}

function upsertScoredSymbol(
    bucket: Map<string, ScoredSymbolMatch>,
    query: string,
    candidate: ResolvedSymbolMatch,
): void {
    const key = `${candidate.path}:${candidate.line}:${candidate.kind}:${candidate.name}`;
    const scored = {
        score: scoreSymbolMatch(query, candidate),
        value: candidate,
    };

    const existing = bucket.get(key);
    if (!existing || scored.score > existing.score) {
        bucket.set(key, scored);
    }
}

function encodeSymbolCursor(payload: SymbolCursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
}

function decodeSymbolCursor(raw: string): SymbolCursorPayload | null {
    try {
        const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
        const parsed = JSON.parse(decoded) as Partial<SymbolCursorPayload>;
        if (typeof parsed.query !== 'string' || typeof parsed.offset !== 'number' || !Number.isFinite(parsed.offset)) {
            return null;
        }
        return {
            query: parsed.query,
            ...(typeof parsed.kind === 'string' ? { kind: parsed.kind } : {}),
            offset: Math.max(0, Math.floor(parsed.offset)),
        };
    } catch {
        return null;
    }
}

export function createServer(options: ServerOptions = {}): http.Server {
    const port = options.port ?? 4096;
    const hostname = options.hostname ?? '127.0.0.1';
    const corsOrigins = new Set(options.cors ?? []);
    const authUser = options.username ?? 'xqoder';
    const authPass = options.password;
    const pendingQuestions = new Map<string, PendingQuestionEntry>();
    const pendingQuestionsByLegacyKey = new Map<string, Set<string>>();
    const streamOperations = new Map<string, StreamOperation>();
    const eventSubscribers = new Set<http.ServerResponse>();
    let lspSymbolManager: ExternalLanguageServerManager | undefined;

    const DEFAULT_STREAM_TIMEOUT_MS = 120000;
    const MIN_STREAM_TIMEOUT_MS = 5000;
    const MAX_STREAM_TIMEOUT_MS = 10 * 60 * 1000;
    const STREAM_GC_TTL_MS = 2 * 60 * 1000;

    function randomId(prefix: string): string {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function parseTimeoutMs(raw: unknown): number {
        const num = Number(raw);
        if (!Number.isFinite(num)) {
            return DEFAULT_STREAM_TIMEOUT_MS;
        }
        return Math.min(MAX_STREAM_TIMEOUT_MS, Math.max(MIN_STREAM_TIMEOUT_MS, Math.floor(num)));
    }

    function closeSubscriber(op: StreamOperation, subscriberId: string): void {
        const subscriber = op.subscribers.get(subscriberId);
        if (!subscriber) {
            return;
        }
        op.subscribers.delete(subscriberId);
        try {
            if (!subscriber.res.writableEnded) {
                subscriber.res.end();
            }
        } catch {
            // ignore socket write failures
        }
    }

    function finalizeOperation(op: StreamOperation): void {
        if (op.gcTimer) {
            clearTimeout(op.gcTimer);
        }
        op.gcTimer = setTimeout(() => {
            streamOperations.delete(op.id);
        }, STREAM_GC_TTL_MS);
        op.gcTimer.unref();
    }

    function appendRecord(op: StreamOperation, record: StreamAppendRecord): StreamWireRecord {
        const seq = op.nextSeq;
        op.nextSeq += 1;
        const wrapped: StreamWireRecord = record.type === 'event'
            ? { type: 'event', event: record.event, streamId: op.id, seq, cursor: seq }
            : record.type === 'done'
                ? { type: 'done', response: record.response, sessionId: record.sessionId, streamId: op.id, seq, cursor: seq }
                : record.type === 'error'
                    ? { type: 'error', message: record.message, streamId: op.id, seq, cursor: seq }
                    : { type: 'cancelled', reason: record.reason, streamId: op.id, seq, cursor: seq };
        op.records.push(wrapped);

        for (const subscriber of op.subscribers.values()) {
            if (wrapped.seq <= subscriber.lastSeq) {
                continue;
            }
            try {
                subscriber.res.write(`${JSON.stringify(wrapped)}\n`);
                subscriber.lastSeq = wrapped.seq;
                if (wrapped.type === 'done' || wrapped.type === 'error' || wrapped.type === 'cancelled') {
                    closeSubscriber(op, subscriber.id);
                }
            } catch {
                closeSubscriber(op, subscriber.id);
            }
        }

        return wrapped;
    }

    function attachStreamSubscriber(
        op: StreamOperation,
        res: http.ServerResponse,
        corsHeaders: Record<string, string>,
        cursor: number,
    ): void {
        res.writeHead(200, {
            ...corsHeaders,
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        let lastSeq = Math.max(0, Math.floor(cursor));
        for (const record of op.records) {
            if (record.seq <= lastSeq) {
                continue;
            }
            res.write(`${JSON.stringify(record)}\n`);
            lastSeq = record.seq;
        }

        if (op.completed) {
            res.end();
            return;
        }

        const subscriberId = randomId('sub');
        op.subscribers.set(subscriberId, {
            id: subscriberId,
            res,
            lastSeq,
        });

        const release = () => {
            op.subscribers.delete(subscriberId);
        };
        res.once('close', release);
        res.once('error', release);
    }

    function publishEvent(event: AppEvent): void {
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        for (const subscriber of eventSubscribers) {
            try {
                subscriber.write(payload);
            } catch {
                eventSubscribers.delete(subscriber);
            }
        }
    }

    const waitForQuestionAnswer = (sessionId: string, streamId: string, prompt: QuestionPrompt): Promise<QuestionAnswer> => {
        const key = `${streamId}:${prompt.requestId}`;
        const legacyKey = `${sessionId}:${prompt.requestId}`;
        return new Promise<QuestionAnswer>((resolve) => {
            const timeout = setTimeout(() => {
                pendingQuestions.delete(key);
                const index = pendingQuestionsByLegacyKey.get(legacyKey);
                if (index) {
                    index.delete(key);
                    if (index.size === 0) {
                        pendingQuestionsByLegacyKey.delete(legacyKey);
                    }
                }
                resolve({
                    requestId: prompt.requestId,
                    selected: prompt.options.length > 0 ? [prompt.options[0]!.label] : [],
                });
            }, 120000);
            timeout.unref();

            pendingQuestions.set(key, {
                sessionId,
                streamId,
                requestId: prompt.requestId,
                fallbackSelected: prompt.options.length > 0 ? [prompt.options[0]!.label] : [],
                resolve: (answer) => {
                    clearTimeout(timeout);
                    resolve(answer);
                },
                timeout,
            });
            const index = pendingQuestionsByLegacyKey.get(legacyKey);
            if (index) {
                index.add(key);
            } else {
                pendingQuestionsByLegacyKey.set(legacyKey, new Set([key]));
            }
        });
    };

    const resolvePendingQuestionsForStream = (streamId: string): void => {
        for (const [key, pending] of pendingQuestions.entries()) {
            if (pending.streamId !== streamId) {
                continue;
            }
            pendingQuestions.delete(key);
            clearTimeout(pending.timeout);
            const legacyKey = `${pending.sessionId}:${pending.requestId}`;
            const index = pendingQuestionsByLegacyKey.get(legacyKey);
            if (index) {
                index.delete(key);
                if (index.size === 0) {
                    pendingQuestionsByLegacyKey.delete(legacyKey);
                }
            }
            pending.resolve({
                requestId: pending.requestId,
                selected: pending.fallbackSelected,
            });
        }
    };

    const beginStreamOperation = (
        params: {
            sessionId: string;
            projectRoot: string;
            message: string;
            attachments?: MessageAttachment[];
            timeoutMs: number;
            runMessageStream: NonNullable<ServerOptions['runMessageStream']>;
        },
    ): StreamOperation => {
        const op: StreamOperation = {
            id: randomId('stream'),
            sessionId: params.sessionId,
            projectRoot: params.projectRoot,
            message: params.message,
            attachments: params.attachments,
            createdAt: Date.now(),
            nextSeq: 1,
            records: [],
            subscribers: new Map(),
            completed: false,
            abortController: new AbortController(),
            timeout: setTimeout(() => {
                if (!op.abortController.signal.aborted) {
                    op.abortController.abort(new Error(`Stream timeout (${params.timeoutMs}ms)`));
                }
            }, params.timeoutMs),
        };
        op.timeout.unref();
        streamOperations.set(op.id, op);

        void params.runMessageStream({
            projectRoot: params.projectRoot,
            sessionId: params.sessionId,
            message: params.message,
            attachments: params.attachments,
            signal: op.abortController.signal,
            onEvent: (event) => {
                if (isDuplicateStatusEvent(op, event)) {
                    return;
                }
                publishEvent(event);
                appendRecord(op, { type: 'event', event });
            },
            requestQuestion: (prompt) => waitForQuestionAnswer(params.sessionId, op.id, prompt),
        }).then((result) => {
            op.completed = true;
            appendRecord(op, {
                type: 'done',
                response: result.response,
                sessionId: result.sessionId,
            });
            clearTimeout(op.timeout);
            finalizeOperation(op);
        }).catch((err) => {
            op.completed = true;
            const aborted = op.abortController.signal.aborted;
            if (aborted) {
                resolvePendingQuestionsForStream(op.id);
                const reason = op.abortController.signal.reason;
                appendRecord(op, {
                    type: 'cancelled',
                    reason: reason instanceof Error ? reason.message : 'Cancelled',
                });
            } else {
                appendRecord(op, {
                    type: 'error',
                    message: err instanceof Error ? err.message : String(err),
                });
            }
            clearTimeout(op.timeout);
            finalizeOperation(op);
        });

        return op;
    };

    const server = http.createServer(async (req, res) => {
        const parsed = url.parse(req.url ?? '/', true);
        const pathname = parsed.pathname ?? '/';

        // CORS preflight
        if (req.method === 'OPTIONS') {
            const origin = req.headers.origin;
            const allowOrigin = origin && (corsOrigins.has(origin) || corsOrigins.has('*'))
                ? origin
                : (corsOrigins.size > 0 ? Array.from(corsOrigins)[0] : '');
            res.writeHead(204, {
                'Access-Control-Allow-Origin': allowOrigin || '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            });
            res.end();
            return;
        }

        // Basic auth
        if (authPass) {
            const auth = req.headers.authorization;
            if (!auth?.startsWith('Basic ')) {
                res.writeHead(401, {
                    'WWW-Authenticate': 'Basic realm="XQoder"',
                    'Content-Type': 'application/json',
                });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
            const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
            const [user, pass] = decoded.split(':');
            if (user !== authUser || pass !== authPass) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
        }

        const origin = req.headers.origin;
        const allowOrigin = origin && corsOrigins.has(origin) ? origin : '*';
        const corsHeaders: Record<string, string> = {
            'Access-Control-Allow-Origin': allowOrigin,
        };

        // GET /global/health
        if (pathname === '/global/health' && req.method === 'GET') {
            res.writeHead(200, {
                ...corsHeaders,
                'Content-Type': 'application/json',
            });
            res.end(JSON.stringify({
                healthy: true,
                version: getXQoderVersion(),
            }));
            return;
        }

        // GET /doc
        if (pathname === '/doc' && req.method === 'GET') {
            const accept = String(req.headers.accept ?? '').toLowerCase();
            if (accept.includes('application/json')) {
                jsonResponse(res, 200, createOpenApiDocument(hostname, port), corsHeaders);
                return;
            }
            res.writeHead(200, {
                ...corsHeaders,
                'Content-Type': 'text/html',
            });
            res.end(`<!DOCTYPE html><html><head><title>XQoder API</title></head><body>
<h1>XQoder Server API</h1>
<p><a href="/doc.openapi.json">/doc.openapi.json</a> — OpenAPI 3.1 JSON</p>
<p><a href="/global/health">/global/health</a> — Health check</p>
<p>GET /session — List sessions (query projectRoot)</p>
<p>POST /session — Create session (body: projectRoot?, title?)</p>
<p>GET /session/:id — Get session summary</p>
<p>GET /project — Serve project root metadata</p>
<p>GET /config — Effective resolved config snapshot</p>
<p>GET /provider — Provider readiness and auth status</p>
<p>GET /file?path=&lt;relativePath&gt; — Read project file</p>
<p>GET /find/file?query=&lt;text&gt; — Search files by path</p>
<p>GET /find?query=&lt;text&gt;[&regex=true] — Search file contents</p>
<p>GET /find/symbol?query=&lt;name&gt;[&kind=function|class|interface|type|variable] — Search symbols</p>
<p>GET /share/:id — Access local share artifact</p>
<p>GET /event — SSE stream for AppEvent records</p>
<p>POST /session/:id/message — Send message (body: message, attachments?)</p>
<p>POST /session/:id/message/stream — Send message and stream events (NDJSON)</p>
<p>POST /session/:id/question/:requestId/resolve — Resolve pending question</p>
<p>POST /session/:id/stream/:streamId/cancel — Cancel active stream</p>
</body></html>`);
            return;
        }

        // GET /doc.openapi.json
        if (pathname === '/doc.openapi.json' && req.method === 'GET') {
            jsonResponse(res, 200, createOpenApiDocument(hostname, port), corsHeaders);
            return;
        }

        const pathParts = pathname.split('/').filter(Boolean);
        const cwd = options.cwd ?? process.cwd();
        const store = options.sessionStore;
        const runMessage = options.runMessage;
        const runMessageStream = options.runMessageStream;
        const defaultModel = options.defaultModel ?? 'openai/gpt-4o';

        const getLspSymbolManager = (): ExternalLanguageServerManager | undefined => {
            if (lspSymbolManager) {
                return lspSymbolManager;
            }
            const loaded = configManager.load({ cwd });
            const resolved = resolveConfigWithEnvOverrides(loaded);
            const servers = resolved.config.lsp?.servers ?? [];
            if (servers.length === 0) {
                return undefined;
            }
            lspSymbolManager = new ExternalLanguageServerManager({
                servers,
                cwd,
                projectRoot: cwd,
            });
            return lspSymbolManager;
        };

        // GET /project
        if (pathname === '/project' && req.method === 'GET') {
            jsonResponse(res, 200, {
                projectRoot: cwd,
                cwd,
                platform: process.platform,
            }, corsHeaders);
            return;
        }

        // GET /config
        if (pathname === '/config' && req.method === 'GET') {
            const loaded = configManager.load({ cwd });
            const resolved = resolveConfigWithEnvOverrides(loaded);
            const providers = Object.fromEntries(
                Object.entries(resolved.config.providers ?? {}).map(([name, provider]) => [
                    name,
                    {
                        ...provider,
                        apiKey: provider?.apiKey ? '[redacted]' : '',
                    },
                ]),
            );
            jsonResponse(res, 200, {
                config: {
                    ...resolved.config,
                    providers,
                    llm: {
                        ...resolved.config.llm,
                        apiKey: resolved.config.llm.apiKey ? '[redacted]' : '',
                    },
                },
                appliedEnvVars: resolved.appliedEnvVars,
            }, corsHeaders);
            return;
        }

        // GET /provider
        if (pathname === '/provider' && req.method === 'GET') {
            const loaded = configManager.load({ cwd });
            const resolved = resolveConfigWithEnvOverrides(loaded);
            const activeProvider = resolved.config.llm.provider;
            const providers = SUPPORTED_LLM_PROVIDERS.map((provider) => {
                const entry = resolved.config.providers?.[provider];
                return {
                    name: provider,
                    current: provider === activeProvider,
                    authenticated: Boolean(entry?.apiKey),
                    disabled: entry?.disabled ?? false,
                    defaultModel: entry?.defaultModel,
                    baseUrl: entry?.baseUrl,
                };
            });
            jsonResponse(res, 200, {
                current: activeProvider,
                providers,
            }, corsHeaders);
            return;
        }

        // GET /event
        if (pathname === '/event' && req.method === 'GET') {
            res.writeHead(200, {
                ...corsHeaders,
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
            });
            res.write(': connected\n\n');
            eventSubscribers.add(res);
            const release = () => {
                eventSubscribers.delete(res);
            };
            res.once('close', release);
            res.once('error', release);
            return;
        }

        // GET /file?path=<relative_path>
        if (pathname === '/file' && req.method === 'GET') {
            const requested = String(parsed.query?.path ?? '').trim();
            if (!requested) {
                jsonResponse(res, 400, { error: 'Missing query parameter: path' }, corsHeaders);
                return;
            }
            const resolvedPath = resolvePathWithinRoot(cwd, requested);
            if (!resolvedPath) {
                jsonResponse(res, 403, { error: 'Path escapes project root' }, corsHeaders);
                return;
            }
            try {
                const stat = fs.statSync(resolvedPath);
                if (!stat.isFile()) {
                    jsonResponse(res, 400, { error: 'Path is not a file', path: requested }, corsHeaders);
                    return;
                }
                const content = readTextFileSafe(resolvedPath);
                jsonResponse(res, 200, {
                    path: path.relative(cwd, resolvedPath) || path.basename(resolvedPath),
                    content,
                }, corsHeaders);
            } catch (err) {
                jsonResponse(res, 404, { error: err instanceof Error ? err.message : String(err) }, corsHeaders);
            }
            return;
        }

        // GET /find/file?query=<text>
        if (pathname === '/find/file' && req.method === 'GET') {
            const query = String(parsed.query?.query ?? '').trim().toLowerCase();
            if (!query) {
                jsonResponse(res, 400, { error: 'Missing query parameter: query' }, corsHeaders);
                return;
            }
            const limit = Math.min(200, Math.max(1, Number(parsed.query?.limit) || 50));
            const files = listProjectFiles(cwd, 5000)
                .map((absolutePath) => path.relative(cwd, absolutePath))
                .filter((relativePath) => relativePath.toLowerCase().includes(query))
                .slice(0, limit);
            jsonResponse(res, 200, {
                query,
                files,
            }, corsHeaders);
            return;
        }

        // GET /find?query=<text>&regex=true|false
        if (pathname === '/find' && req.method === 'GET') {
            const query = String(parsed.query?.query ?? '').trim();
            if (!query) {
                jsonResponse(res, 400, { error: 'Missing query parameter: query' }, corsHeaders);
                return;
            }
            const useRegex = String(parsed.query?.regex ?? '').toLowerCase() === 'true';
            const limit = Math.min(200, Math.max(1, Number(parsed.query?.limit) || 50));
            const hits: Array<{ path: string; line: number; text: string }> = [];
            const matcher = useRegex ? new RegExp(query) : null;
            const files = listProjectFiles(cwd, 1000);

            for (const absolutePath of files) {
                if (hits.length >= limit) {
                    break;
                }
                let content = '';
                try {
                    content = readTextFileSafe(absolutePath, 256 * 1024);
                } catch {
                    continue;
                }
                const lines = content.split(/\r?\n/);
                for (let index = 0; index < lines.length; index += 1) {
                    if (hits.length >= limit) {
                        break;
                    }
                    const line = lines[index] ?? '';
                    const matched = matcher ? matcher.test(line) : line.includes(query);
                    if (!matched) {
                        continue;
                    }
                    hits.push({
                        path: path.relative(cwd, absolutePath),
                        line: index + 1,
                        text: line,
                    });
                }
            }

            jsonResponse(res, 200, {
                query,
                regex: useRegex,
                matches: hits,
            }, corsHeaders);
            return;
        }

        // GET /find/symbol?query=<name>&kind=<kind>
        if (pathname === '/find/symbol' && req.method === 'GET') {
            const rawQuery = String(parsed.query?.query ?? '').trim();
            if (!rawQuery) {
                jsonResponse(res, 400, { error: 'Missing query parameter: query' }, corsHeaders);
                return;
            }
            const query = rawQuery.toLowerCase();
            const kindFilter = String(parsed.query?.kind ?? '').trim().toLowerCase();
            const rawCursor = String(parsed.query?.cursor ?? '').trim();
            const limit = Math.min(200, Math.max(1, Number(parsed.query?.limit) || 50));
            const symbolBucket = new Map<string, ScoredSymbolMatch>();
            let lspAttempted = false;
            let lspSucceeded = false;

            let offset = 0;
            if (rawCursor) {
                const cursor = decodeSymbolCursor(rawCursor);
                if (!cursor) {
                    jsonResponse(res, 400, { error: 'Invalid cursor' }, corsHeaders);
                    return;
                }
                if (cursor.query !== rawQuery || (cursor.kind ?? '') !== kindFilter) {
                    jsonResponse(res, 400, { error: 'Cursor does not match query/kind' }, corsHeaders);
                    return;
                }
                offset = cursor.offset;
            }

            const lspManager = getLspSymbolManager();
            if (lspManager) {
                lspAttempted = true;
                try {
                    const lspMatches = await lspManager.listWorkspaceSymbols(rawQuery, limit * 2);
                    lspSucceeded = true;
                    for (const lspMatch of lspMatches) {
                        const normalized = toResolvedLspSymbolMatch(lspMatch, cwd);
                        if (!normalized) {
                            continue;
                        }
                        if (!normalized.name.toLowerCase().includes(query)) {
                            continue;
                        }
                        if (kindFilter && normalized.kind !== kindFilter) {
                            continue;
                        }
                        upsertScoredSymbol(symbolBucket, query, normalized);
                    }
                } catch {
                    // graceful fallback to scan-based implementation
                }
            }

            const files = listProjectFiles(cwd, 10000)
                .filter((absolutePath) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|swift|rs|cpp|cc|c|h|hpp)$/i.test(absolutePath));

            for (const absolutePath of files) {
                let content = '';
                try {
                    content = readTextFileSafe(absolutePath, 256 * 1024);
                } catch {
                    continue;
                }

                const lines = content.split(/\r?\n/);
                for (let index = 0; index < lines.length; index += 1) {
                    const line = lines[index] ?? '';
                    const symbol = detectSymbolInLine(line);
                    if (!symbol) {
                        continue;
                    }
                    if (!symbol.name.toLowerCase().includes(query)) {
                        continue;
                    }
                    if (kindFilter && kindFilter !== symbol.kind) {
                        continue;
                    }

                    const relativePath = path.relative(cwd, absolutePath);
                    upsertScoredSymbol(symbolBucket, query, {
                        name: symbol.name,
                        kind: symbol.kind,
                        path: relativePath,
                        line: index + 1,
                        text: line,
                        source: 'scan',
                    });
                }
            }

            const matches = Array.from(symbolBucket.values())
                .sort((left, right) => {
                    if (left.score !== right.score) {
                        return right.score - left.score;
                    }
                    if (left.value.source !== right.value.source) {
                        return left.value.source === 'lsp' ? -1 : 1;
                    }
                    if (left.value.path !== right.value.path) {
                        return left.value.path.localeCompare(right.value.path);
                    }
                    return left.value.line - right.value.line;
                })
                .map((entry) => entry.value);

            const paged = matches.slice(offset, offset + limit);
            const nextOffset = offset + paged.length;
            const nextCursor = nextOffset < matches.length
                ? encodeSymbolCursor({
                    query: rawQuery,
                    ...(kindFilter ? { kind: kindFilter } : {}),
                    offset: nextOffset,
                })
                : undefined;

            jsonResponse(res, 200, {
                query: rawQuery,
                kind: kindFilter || undefined,
                strategy: {
                    lspAttempted,
                    lspSucceeded,
                    fallbackScan: true,
                },
                pagination: {
                    cursor: rawCursor || '',
                    ...(nextCursor ? { nextCursor } : {}),
                    total: matches.length,
                },
                symbols: paged,
            }, corsHeaders);
            return;
        }

        // GET /share/:id
        if (pathParts[0] === 'share' && pathParts.length === 2 && pathParts[1] && req.method === 'GET') {
            const shareId = pathParts[1];
            const shareStore = options.shareStore;
            if (!shareStore) {
                jsonResponse(res, 503, { error: 'Share store not configured' }, corsHeaders);
                return;
            }
            const share = shareStore.getShare(shareId);
            if (!share) {
                jsonResponse(res, 404, { error: 'Share not found', id: shareId }, corsHeaders);
                return;
            }

            if (share.format === 'json') {
                try {
                    const parsed = JSON.parse(share.content);
                    jsonResponse(res, 200, parsed, corsHeaders);
                } catch {
                    jsonResponse(res, 200, {
                        id: share.id,
                        sessionId: share.sessionId,
                        title: share.title,
                        projectRoot: share.projectRoot,
                        createdAt: share.createdAt.toISOString(),
                        format: share.format,
                        content: share.content,
                    }, corsHeaders);
                }
                return;
            }

            res.writeHead(200, {
                ...corsHeaders,
                'Content-Type': 'text/markdown; charset=utf-8',
            });
            res.end(share.content);
            return;
        }

        // GET /session — list
        if (pathParts[0] === 'session' && pathParts.length === 1 && req.method === 'GET') {
            if (!store) {
                jsonResponse(res, 503, { error: 'Session store not configured' }, corsHeaders);
                return;
            }
            const projectRoot = (parsed.query?.projectRoot as string) || cwd;
            const limit = Math.min(100, Math.max(1, Number(parsed.query?.limit) || 20));
            const summaries = store.listSessions(projectRoot, limit);
            const out = summaries.map((s) => ({
                id: s.id,
                projectRoot: s.projectRoot,
                cwd: s.cwd,
                model: s.model,
                title: s.title,
                createdAt: s.createdAt.toISOString(),
                updatedAt: s.updatedAt.toISOString(),
                messageCount: s.messageCount,
            }));
            jsonResponse(res, 200, out, corsHeaders);
            return;
        }

        // POST /session — create
        if (pathParts[0] === 'session' && pathParts.length === 1 && req.method === 'POST') {
            if (!store) {
                jsonResponse(res, 503, { error: 'Session store not configured' }, corsHeaders);
                return;
            }
            readBody(req).then((raw) => {
                try {
                    const body = (raw ? JSON.parse(raw) : {}) as { projectRoot?: string; title?: string };
                    const projectRoot = body.projectRoot ? String(body.projectRoot) : cwd;
                    const title = body.title != null ? String(body.title) : undefined;
                    const summary = store.createEmptySession(projectRoot, defaultModel, title);
                    jsonResponse(res, 200, {
                        id: summary.id,
                        projectRoot: summary.projectRoot,
                        cwd: summary.cwd,
                        model: summary.model,
                        title: summary.title,
                        createdAt: summary.createdAt.toISOString(),
                        updatedAt: summary.updatedAt.toISOString(),
                        messageCount: summary.messageCount,
                    }, corsHeaders);
                } catch (e) {
                    jsonResponse(res, 400, { error: e instanceof Error ? e.message : 'Bad request' }, corsHeaders);
                }
            }).catch(() => jsonResponse(res, 400, { error: 'Invalid JSON body' }, corsHeaders));
            return;
        }

        // GET /session/:id
        if (pathParts[0] === 'session' && pathParts.length === 2 && pathParts[1] && req.method === 'GET') {
            if (!store) {
                jsonResponse(res, 503, { error: 'Session store not configured' }, corsHeaders);
                return;
            }
            const sessionId = pathParts[1];
            const summary = store.getSessionSummary(sessionId);
            if (!summary) {
                jsonResponse(res, 404, { error: 'Session not found', id: sessionId }, corsHeaders);
                return;
            }
            jsonResponse(res, 200, {
                id: summary.id,
                projectRoot: summary.projectRoot,
                cwd: summary.cwd,
                model: summary.model,
                title: summary.title,
                createdAt: summary.createdAt.toISOString(),
                updatedAt: summary.updatedAt.toISOString(),
                messageCount: summary.messageCount,
                usage: summary.usage,
            }, corsHeaders);
            return;
        }

        // GET /session/:id/messages — 拉取会话历史（attach 切换 session 时恢复 transcript）
        if (pathParts[0] === 'session' && pathParts.length === 3 && pathParts[1] && pathParts[2] === 'messages' && req.method === 'GET') {
            if (!store) {
                jsonResponse(res, 503, { error: 'Session store not configured' }, corsHeaders);
                return;
            }
            const sessionId = pathParts[1];
            const session = store.getSession(sessionId);
            if (!session) {
                jsonResponse(res, 404, { error: 'Session not found', id: sessionId }, corsHeaders);
                return;
            }
            const messages = session.getMessages();
            jsonResponse(res, 200, { messages }, corsHeaders);
            return;
        }

        // POST /session/:id/stream/:streamId/cancel
        if (
            pathParts[0] === 'session'
            && pathParts.length === 5
            && pathParts[1]
            && pathParts[2] === 'stream'
            && pathParts[3]
            && pathParts[4] === 'cancel'
            && req.method === 'POST'
        ) {
            const sessionId = pathParts[1];
            const streamId = pathParts[3];
            const op = streamOperations.get(streamId);
            if (!op || op.sessionId !== sessionId) {
                jsonResponse(res, 404, { error: 'Stream not found', sessionId, streamId }, corsHeaders);
                return;
            }
            if (!op.abortController.signal.aborted) {
                op.abortController.abort(new Error('Cancelled by client'));
            }
            resolvePendingQuestionsForStream(op.id);
            jsonResponse(res, 200, { ok: true, streamId }, corsHeaders);
            return;
        }

        // POST /session/:id/question/:requestId/resolve
        if (
            pathParts[0] === 'session'
            && pathParts.length === 5
            && pathParts[1]
            && pathParts[2] === 'question'
            && pathParts[3]
            && pathParts[4] === 'resolve'
            && req.method === 'POST'
        ) {
            const sessionId = pathParts[1];
            const requestId = pathParts[3];
            readBody(req).then((raw) => {
                try {
                    const body = (raw ? JSON.parse(raw) : {}) as { selected?: string[]; customText?: string; streamId?: string };
                    const candidates = (() => {
                        if (typeof body.streamId === 'string' && body.streamId.trim()) {
                            return [`${body.streamId.trim()}:${requestId}`];
                        }
                        const keys = pendingQuestionsByLegacyKey.get(`${sessionId}:${requestId}`);
                        return keys ? Array.from(keys) : [];
                    })();

                    if (candidates.length === 0) {
                        jsonResponse(res, 404, { error: 'Question request not found', sessionId, requestId }, corsHeaders);
                        return;
                    }
                    if (candidates.length > 1) {
                        jsonResponse(res, 409, { error: 'Multiple pending question requests; specify streamId', sessionId, requestId }, corsHeaders);
                        return;
                    }

                    const key = candidates[0]!;
                    const pending = pendingQuestions.get(key);
                    if (!pending) {
                        jsonResponse(res, 404, { error: 'Question request not found', sessionId, requestId }, corsHeaders);
                        return;
                    }
                    const selected = Array.isArray(body.selected)
                        ? body.selected.filter((entry): entry is string => typeof entry === 'string')
                        : [];
                    const answer: QuestionAnswer = {
                        requestId,
                        selected,
                        ...(typeof body.customText === 'string' && body.customText.trim().length > 0
                            ? { customText: body.customText.trim() }
                            : {}),
                    };
                    pendingQuestions.delete(key);
                    const legacyKey = `${sessionId}:${requestId}`;
                    const index = pendingQuestionsByLegacyKey.get(legacyKey);
                    if (index) {
                        index.delete(key);
                        if (index.size === 0) {
                            pendingQuestionsByLegacyKey.delete(legacyKey);
                        }
                    }
                    pending.resolve(answer);
                    jsonResponse(res, 200, { ok: true }, corsHeaders);
                } catch (err) {
                    jsonResponse(res, 400, { error: err instanceof Error ? err.message : 'Invalid JSON body' }, corsHeaders);
                }
            }).catch(() => jsonResponse(res, 400, { error: 'Invalid JSON body' }, corsHeaders));
            return;
        }

        // POST /session/:id/message
        if (pathParts[0] === 'session' && pathParts.length === 3 && pathParts[1] && pathParts[2] === 'message' && req.method === 'POST') {
            if (!runMessage || !store) {
                jsonResponse(res, 503, { error: 'Server not configured for messages' }, corsHeaders);
                return;
            }
            const sessionId = pathParts[1];
            const summary = store.getSessionSummary(sessionId);
            if (!summary) {
                jsonResponse(res, 404, { error: 'Session not found', id: sessionId }, corsHeaders);
                return;
            }
            readBody(req).then((raw) => {
                try {
                    const body = (raw ? JSON.parse(raw) : {}) as { message?: string; attachments?: MessageAttachment[] };
                    const message = body.message != null ? String(body.message) : '';
                    if (!message.trim()) {
                        jsonResponse(res, 400, { error: 'Missing or empty message' }, corsHeaders);
                        return;
                    }
                    runMessage({
                        projectRoot: summary.projectRoot,
                        sessionId,
                        message: message.trim(),
                        attachments: body.attachments,
                    }).then((result) => {
                        jsonResponse(res, 200, { response: result.response, sessionId: result.sessionId }, corsHeaders);
                    }).catch((err) => {
                        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) }, corsHeaders);
                    });
                } catch (e) {
                    jsonResponse(res, 400, { error: e instanceof Error ? e.message : 'Invalid JSON body' }, corsHeaders);
                }
            }).catch(() => jsonResponse(res, 400, { error: 'Invalid JSON body' }, corsHeaders));
            return;
        }

        // POST /session/:id/message/stream
        if (
            pathParts[0] === 'session'
            && pathParts.length === 4
            && pathParts[1]
            && pathParts[2] === 'message'
            && pathParts[3] === 'stream'
            && req.method === 'POST'
        ) {
            if (!runMessageStream || !store) {
                jsonResponse(res, 503, { error: 'Server not configured for message streaming' }, corsHeaders);
                return;
            }
            const sessionId = pathParts[1];
            const summary = store.getSessionSummary(sessionId);
            if (!summary) {
                jsonResponse(res, 404, { error: 'Session not found', id: sessionId }, corsHeaders);
                return;
            }

            readBody(req).then((raw) => {
                let body: StreamRequestBody;
                try {
                    body = (raw ? JSON.parse(raw) : {}) as StreamRequestBody;
                } catch (err) {
                    jsonResponse(res, 400, { error: err instanceof Error ? err.message : 'Invalid JSON body' }, corsHeaders);
                    return;
                }

                const cursor = Number.isFinite(Number(body.cursor)) ? Math.max(0, Math.floor(Number(body.cursor))) : 0;
                const requestedStreamId = typeof body.streamId === 'string' && body.streamId.trim().length > 0
                    ? body.streamId.trim()
                    : undefined;

                let operation: StreamOperation | undefined;
                if (requestedStreamId) {
                    operation = streamOperations.get(requestedStreamId);
                    if (!operation || operation.sessionId !== sessionId) {
                        jsonResponse(res, 404, { error: 'Stream not found', sessionId, streamId: requestedStreamId }, corsHeaders);
                        return;
                    }
                } else {
                    const message = body.message != null ? String(body.message) : '';
                    if (!message.trim()) {
                        jsonResponse(res, 400, { error: 'Missing or empty message' }, corsHeaders);
                        return;
                    }
                    operation = beginStreamOperation({
                        sessionId,
                        projectRoot: summary.projectRoot,
                        message: message.trim(),
                        attachments: body.attachments,
                        timeoutMs: parseTimeoutMs(body.timeoutMs),
                        runMessageStream,
                    });
                }

                attachStreamSubscriber(operation, res, corsHeaders, cursor);
            }).catch(() => jsonResponse(res, 400, { error: 'Invalid JSON body' }, corsHeaders));
            return;
        }

        // 404
        res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
    });

    server.listen(port, hostname, () => {
        // 由调用方打印
    });

    server.on('close', () => {
        if (!lspSymbolManager) {
            return;
        }
        void lspSymbolManager.dispose().catch(() => {
            // ignore LSP shutdown failures on server close
        });
    });

    return server;
}
