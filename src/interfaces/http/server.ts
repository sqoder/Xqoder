// XQoder HTTP Server — HTTP interface implementation
// ============================================================

import * as http from 'node:http';
import * as url from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getXQoderVersion } from '../../cli/version.js';
import {
    ExternalLanguageServerManager,
    type AgentSessionStore,
    type ToolApprovalRequest,
} from '@xqoder/agent';
import {
    configManager,
    resolveConfigWithEnvOverrides,
    type MessageAttachment,
} from '@xqoder/shared';
import type { ConversationEventEnvelope } from '@xqoder/protocol';
import type { QuestionAnswer, QuestionPrompt } from '@xqoder/plugin-sdk';
import type { SessionShareStore } from '../../features/sessions/assets.js';
import {
    jsonResponse,
    readTextFileSafe,
    resolvePathWithinRoot,
} from './server-helpers.js';
import { handleMetaRoutes } from './server-meta.js';
import {
    findProjectFilesByPath,
    findProjectSymbols,
    searchProjectContent,
} from './server-search.js';
import {
    handleMessageRoutes,
    handleSessionRoutes,
} from './server-session.js';
import {
    createStreamController,
} from './server-stream.js';

export interface ServerOptions {
    port?: number;
    hostname?: string;
    cors?: string[];
    password?: string;
    username?: string;
    /** Project root directory (cwd when serving) */
    cwd?: string;
    /** Default model (used when creating a new session) */
    defaultModel?: string;
    sessionStore?: AgentSessionStore;
    shareStore?: SessionShareStore;
    /** Runs a message on a specific session, returns response and sessionId */
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
        onEvent: (event: ConversationEventEnvelope) => void;
        requestQuestion: (prompt: QuestionPrompt) => Promise<QuestionAnswer>;
        requestToolApproval: (request: ToolApprovalRequest) => Promise<boolean>;
        signal?: AbortSignal;
    }) => Promise<{ response: string; sessionId: string }>;
}

export function createServer(options: ServerOptions = {}): http.Server {
    const port = options.port ?? 4096;
    const hostname = options.hostname ?? '127.0.0.1';
    const corsOrigins = new Set(options.cors ?? []);
    const authUser = options.username ?? 'xqoder';
    const authPass = options.password;
    let lspSymbolManager: ExternalLanguageServerManager | undefined;
    const streamController = createStreamController({
        onApprovalPending: (record) => {
            persistPendingApproval(options.sessionStore, record);
        },
        onApprovalResolved: (record) => {
            persistResolvedApproval(options.sessionStore, record);
        },
    });

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

        const pathParts = pathname.split('/').filter(Boolean);
        const cwd = options.cwd ?? process.cwd();
        const store = options.sessionStore;
        const runMessage = options.runMessage;
        const runMessageStream = options.runMessageStream;
        const defaultModel = options.defaultModel ?? 'openai/gpt-4o';
        const loadResolvedConfig = () => resolveConfigWithEnvOverrides(configManager.load({ cwd }));

        const getLspSymbolManager = (): ExternalLanguageServerManager | undefined => {
            if (lspSymbolManager) {
                return lspSymbolManager;
            }
            const resolved = loadResolvedConfig();
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

        if (await handleMetaRoutes({
            req,
            res,
            pathname,
            pathParts,
            cwd,
            hostname,
            port,
            corsHeaders,
            ...(options.shareStore ? { shareStore: options.shareStore } : {}),
            loadResolvedConfig,
        })) {
            return;
        }

        // GET /event
        if (pathname === '/event' && req.method === 'GET') {
            streamController.addEventSubscriber(res, corsHeaders);
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
            jsonResponse(res, 200, {
                query,
                files: findProjectFilesByPath(cwd, query, Number(parsed.query?.limit) || 50),
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
            jsonResponse(res, 200, {
                query,
                regex: useRegex,
                matches: searchProjectContent(cwd, query, {
                    regex: useRegex,
                    limit: Number(parsed.query?.limit) || 50,
                }),
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
            const lspManager = getLspSymbolManager();
            const result = await findProjectSymbols({
                projectRoot: cwd,
                rawQuery,
                kindFilter: String(parsed.query?.kind ?? ''),
                rawCursor: String(parsed.query?.cursor ?? ''),
                limit: Number(parsed.query?.limit) || 50,
                ...(lspManager ? { lspManager } : {}),
            });

            if (result.ok === false) {
                jsonResponse(res, result.status, result.body, corsHeaders);
                return;
            }

            jsonResponse(res, 200, result.body, corsHeaders);
            return;
        }

        if (await handleSessionRoutes({
            req,
            res,
            pathParts,
            parsed,
            cwd,
            defaultModel,
            ...(store ? { store } : {}),
            corsHeaders,
        })) {
            return;
        }

        if (await handleMessageRoutes({
            req,
            res,
            pathParts,
            ...(store ? { store } : {}),
            ...(runMessage ? { runMessage } : {}),
            ...(runMessageStream ? { runMessageStream } : {}),
            streamController,
            corsHeaders,
        })) {
            return;
        }

        // 404
        res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
    });

    server.listen(port, hostname, () => {
        // Logged by caller
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

function persistPendingApproval(
    store: AgentSessionStore | undefined,
    record: {
        sessionId: string;
        streamId: string;
        requestId: string;
        request: ToolApprovalRequest;
        requestedAt: Date;
    },
): void {
    persistApprovalMutation(store, record.sessionId, (session) => {
        const risk = record.request.risk;
        session.recordApprovalRequested({
            requestId: record.requestId,
            ...(record.request.toolCallId ? { toolCallId: record.request.toolCallId } : {}),
            ...(record.request.toolName ? { toolName: record.request.toolName } : {}),
            kind: 'tool',
            summary: record.request.summary,
            ...(record.request.reason ? { reason: record.request.reason } : {}),
            ...(record.request.preview ? { preview: record.request.preview } : {}),
            ...(risk === 'low' || risk === 'medium' || risk === 'high' ? { risk } : {}),
            requestedAt: record.requestedAt,
            source: 'http',
            streamId: record.streamId,
        });
    });
}

function persistResolvedApproval(
    store: AgentSessionStore | undefined,
    record: {
        sessionId: string;
        streamId: string;
        requestId: string;
        decision: 'allow' | 'deny';
        resolvedAt: Date;
    },
): void {
    persistApprovalMutation(store, record.sessionId, (session) => {
        const pending = session.getPendingApprovals().find((entry) =>
            entry.requestId === record.requestId
            && entry.streamId === record.streamId
        );
        session.recordApprovalResolved({
            requestId: record.requestId,
            ...(pending?.toolCallId ? { toolCallId: pending.toolCallId } : {}),
            ...(pending?.toolName ? { toolName: pending.toolName } : {}),
            kind: pending?.kind ?? 'tool',
            summary: pending?.summary ?? `Approval ${record.requestId}`,
            ...(pending?.reason ? { reason: pending.reason } : {}),
            ...(pending?.preview ? { preview: pending.preview } : {}),
            ...(pending?.risk ? { risk: pending.risk } : {}),
            decision: record.decision,
            requestedAt: pending?.requestedAt ?? record.resolvedAt,
            resolvedAt: record.resolvedAt,
            source: pending?.source ?? 'http',
            streamId: record.streamId,
        });
    });
}

function persistApprovalMutation(
    store: AgentSessionStore | undefined,
    sessionId: string,
    mutate: (session: NonNullable<ReturnType<AgentSessionStore['getSession']>>) => void,
): void {
    if (!store) {
        return;
    }

    const session = store.getSession(sessionId);
    const summary = store.getSessionSummary(sessionId);
    if (!session || !summary) {
        return;
    }

    mutate(session);
    store.saveSession({
        session,
        projectRoot: summary.projectRoot,
        cwd: summary.cwd,
        model: summary.model,
        title: summary.title,
        options: {
            persistLastUserMessage: false,
        },
    });
}
