import * as http from 'node:http';
import { SUPPORTED_LLM_PROVIDERS } from '@xqoder/shared';
import type { SessionShareStore } from '../../features/sessions/assets.js';
import { jsonResponse } from './server-helpers.js';
import { createOpenApiDocument } from './server-openapi.js';

interface ProviderConfigSnapshot {
    apiKey?: string;
    disabled?: boolean;
    defaultModel?: string;
    baseUrl?: string;
}

export interface ResolvedConfigSnapshot {
    config: {
        providers?: Record<string, ProviderConfigSnapshot>;
        llm: {
            provider: string;
            apiKey?: string;
        };
    };
    appliedEnvVars: string[];
}

export interface MetaRouteParams {
    req: http.IncomingMessage;
    res: http.ServerResponse;
    pathname: string;
    pathParts: string[];
    cwd: string;
    hostname: string;
    port: number;
    corsHeaders: Record<string, string>;
    shareStore?: SessionShareStore;
    loadResolvedConfig: () => ResolvedConfigSnapshot;
    getOpenApiDocument?: (hostname: string, port: number) => unknown;
}

function renderDocHtml(): string {
    return `<!DOCTYPE html><html><head><title>XQoder API</title></head><body>
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
<p>GET /event — SSE stream for ConversationEventEnvelope records</p>
<p>POST /session/:id/message — Send message (body: message, attachments?)</p>
<p>POST /session/:id/message/stream — Send message and stream events (NDJSON)</p>
<p>POST /session/:id/question/:requestId/resolve — Resolve pending question</p>
<p>POST /session/:id/stream/:streamId/cancel — Cancel active stream</p>
</body></html>`;
}

function buildRedactedConfigSnapshot(snapshot: ResolvedConfigSnapshot): {
    config: Record<string, unknown>;
    appliedEnvVars: string[];
} {
    const providers = Object.fromEntries(
        Object.entries(snapshot.config.providers ?? {}).map(([name, provider]) => [
            name,
            {
                ...provider,
                apiKey: provider?.apiKey ? '[redacted]' : '',
            },
        ]),
    );

    return {
        config: {
            ...snapshot.config,
            providers,
            llm: {
                ...snapshot.config.llm,
                apiKey: snapshot.config.llm.apiKey ? '[redacted]' : '',
            },
        },
        appliedEnvVars: snapshot.appliedEnvVars,
    };
}

function buildProviderSnapshot(snapshot: ResolvedConfigSnapshot): {
    current: string;
    providers: Array<{
        name: string;
        current: boolean;
        authenticated: boolean;
        disabled: boolean;
        defaultModel?: string;
        baseUrl?: string;
    }>;
} {
    const activeProvider = snapshot.config.llm.provider;

    return {
        current: activeProvider,
        providers: SUPPORTED_LLM_PROVIDERS.map((provider) => {
            const entry = snapshot.config.providers?.[provider];
            return {
                name: provider,
                current: provider === activeProvider,
                authenticated: Boolean(entry?.apiKey),
                disabled: entry?.disabled ?? false,
                defaultModel: entry?.defaultModel as string | undefined,
                baseUrl: entry?.baseUrl as string | undefined,
            };
        }),
    };
}

export async function handleMetaRoutes(params: MetaRouteParams): Promise<boolean> {
    const {
        req,
        res,
        pathname,
        pathParts,
        cwd,
        hostname,
        port,
        corsHeaders,
        shareStore,
        loadResolvedConfig,
        getOpenApiDocument = createOpenApiDocument,
    } = params;

    if (pathname === '/doc' && req.method === 'GET') {
        const accept = String(req.headers.accept ?? '').toLowerCase();
        if (accept.includes('application/json')) {
            jsonResponse(res, 200, getOpenApiDocument(hostname, port), corsHeaders);
            return true;
        }

        res.writeHead(200, {
            ...corsHeaders,
            'Content-Type': 'text/html',
        });
        res.end(renderDocHtml());
        return true;
    }

    if (pathname === '/doc.openapi.json' && req.method === 'GET') {
        jsonResponse(res, 200, getOpenApiDocument(hostname, port), corsHeaders);
        return true;
    }

    if (pathname === '/project' && req.method === 'GET') {
        jsonResponse(res, 200, {
            projectRoot: cwd,
            cwd,
            platform: process.platform,
        }, corsHeaders);
        return true;
    }

    if (pathname === '/config' && req.method === 'GET') {
        jsonResponse(res, 200, buildRedactedConfigSnapshot(loadResolvedConfig()), corsHeaders);
        return true;
    }

    if (pathname === '/provider' && req.method === 'GET') {
        jsonResponse(res, 200, buildProviderSnapshot(loadResolvedConfig()), corsHeaders);
        return true;
    }

    if (pathParts[0] === 'share' && pathParts.length === 2 && pathParts[1] && req.method === 'GET') {
        const shareId = pathParts[1];
        if (!shareStore) {
            jsonResponse(res, 503, { error: 'Share store not configured' }, corsHeaders);
            return true;
        }

        const share = shareStore.getShare(shareId);
        if (!share) {
            jsonResponse(res, 404, { error: 'Share not found', id: shareId }, corsHeaders);
            return true;
        }

        if (share.format === 'json') {
            try {
                jsonResponse(res, 200, JSON.parse(share.content), corsHeaders);
            } catch {
                jsonResponse(res, 200, {
                    id: share.id,
                    sessionId: share.sessionId,
                    title: share.title,
                    projectRoot: share.projectRoot,
                    createdAt: share.createdAt.toISOString(),
                    format: share.format,
                    ...(share.usage ? { usage: share.usage } : {}),
                    content: share.content,
                }, corsHeaders);
            }
            return true;
        }

        res.writeHead(200, {
            ...corsHeaders,
            'Content-Type': 'text/markdown; charset=utf-8',
        });
        res.end(share.content);
        return true;
    }

    return false;
}
