// ============================================================
// Fetch Tool — Retrieve content from URL
// Reference: internal/llm/tools/fetch.go
// ============================================================

import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolApprovalRequest, ToolContext } from './tool.js';
import { checkUrlSafety } from './url-safety.js';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

/**
 * FetchUrlTool
 * Retrieves content from a URL and returns it in specified format (text / markdown / html)
 */
export class FetchUrlTool implements ITool {
    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return true;
    }

    readonly definition: ToolDefinition = {
        name: 'fetch_url',
        description: [
            'Retrieve content from a URL and return it.',
            'Supports three output formats: text (extract plain text), markdown (HTML to Markdown), html (raw HTML).',
            'Suitable for retrieving documents, API responses, or web page content.',
            'Restrictions: Maximum response size 5MB. https:// only by default; set allowHttp=true to permit http://.',
            'Hosts resolving to loopback, link-local, private (RFC1918), ULA, or cloud metadata ranges are blocked to prevent SSRF.',
        ].join('\n'),
        parameters: [
            { name: 'url', type: 'string', description: 'The URL to fetch content from', required: true },
            {
                name: 'format',
                type: 'string',
                description: 'Format of the returned content: text, markdown, or html',
                required: false,
                default: 'text',
            },
            {
                name: 'timeout',
                type: 'number',
                description: 'Request timeout in seconds (maximum 120)',
                required: false,
            },
            {
                name: 'allowHttp',
                type: 'boolean',
                description: 'Opt in to plaintext http:// URLs (default false; https:// only)',
                required: false,
            },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>): ToolApprovalRequest {
        const url = String(args['url'] ?? '');
        return {
            toolCallId: String(args['toolCallId'] ?? ''),
            toolName: this.definition.name,
            summary: `Fetch content from: ${url}`,
            reason: 'Network requests may send data to external servers and reach private networks',
            risk: 'high',
        };
    }

    async execute(
        args: Record<string, unknown>,
        _context: ToolContext,
    ): Promise<ToolResult> {
        const toolCallId = String(args['toolCallId'] ?? '');
        const url = String(args['url'] ?? '');
        const format = String(args['format'] ?? 'text').toLowerCase();
        const timeoutSec = Number(args['timeout']) || DEFAULT_TIMEOUT_MS / 1000;
        const allowHttp = args['allowHttp'] === true;

        if (!url) {
            return { toolCallId, success: false, output: '', error: 'URL parameter cannot be empty' };
        }

        if (!['text', 'markdown', 'html'].includes(format)) {
            return { toolCallId, success: false, output: '', error: 'format must be text, markdown, or html' };
        }

        const safety = await checkUrlSafety(url, { allowHttp });
        if (safety.allowed === false) {
            return { toolCallId, success: false, output: '', error: `URL rejected: ${safety.reason}` };
        }

        const effectiveTimeout = Math.min(timeoutSec * 1000, MAX_TIMEOUT_MS);

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), effectiveTimeout);

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'xqoder/1.0',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
            });

            clearTimeout(timer);

            if (!response.ok) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `HTTP ${response.status}: ${response.statusText}`,
                };
            }

            // Check Content-Length
            const contentLength = response.headers.get('content-length');
            if (contentLength && Number(contentLength) > MAX_RESPONSE_SIZE) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Response body too large: ${contentLength} bytes (limit 5MB)`,
                };
            }

            const rawBody = await response.text();
            const body = rawBody.length > MAX_RESPONSE_SIZE
                ? rawBody.slice(0, MAX_RESPONSE_SIZE)
                : rawBody;

            const contentType = response.headers.get('content-type') ?? '';
            const isHtml = contentType.includes('text/html');

            let output: string;

            switch (format) {
                case 'text':
                    output = isHtml ? extractTextFromHtml(body) : body;
                    break;
                case 'markdown':
                    output = isHtml ? convertHtmlToBasicMarkdown(body) : `\`\`\`\n${body}\n\`\`\``;
                    break;
                case 'html':
                    output = body;
                    break;
                default:
                    output = body;
            }

            // Truncate long output
            if (output.length > 100_000) {
                output = output.slice(0, 100_000) + '\n\n... [Content truncated, original length: ' + output.length + ' chars]';
            }

            return {
                toolCallId,
                success: true,
                output,
                metadata: {
                    url,
                    status: response.status,
                    contentType,
                    contentLength: body.length,
                    format,
                },
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const isTimeout = message.includes('abort');

            return {
                toolCallId,
                success: false,
                output: '',
                error: isTimeout
                    ? `Request timed out (${timeoutSec}s): ${url}`
                    : `Fetch failed: ${message}`,
            };
        }
    }
}

/**
 * WebSearchTool
 * Uses DuckDuckGo HTML search page for lightweight search without a key.
 */
export class WebSearchTool implements ITool {
    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return true;
    }

    readonly definition: ToolDefinition = {
        name: 'websearch',
        description: [
            'Search the internet for public information and return structured results.',
            'Uses DuckDuckGo HTML search by default, no API Key required.',
            'Parameters: query and limit (default 5, maximum 10).',
        ].join('\n'),
        parameters: [
            { name: 'query', type: 'string', description: 'Search keywords', required: true },
            { name: 'limit', type: 'number', description: 'Number of results to return (1-10)', required: false, default: 5 },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>): ToolApprovalRequest {
        const query = String(args['query'] ?? '');
        return {
            toolCallId: String(args['toolCallId'] ?? ''),
            toolName: this.definition.name,
            summary: `Search web for: ${query}`,
            reason: 'Web search requests external search engines',
            risk: 'medium',
        };
    }

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const toolCallId = String(args['toolCallId'] ?? '');
        const query = String(args['query'] ?? '').trim();
        const limitRaw = Number(args['limit']);
        const limit = Number.isFinite(limitRaw) ? Math.min(10, Math.max(1, Math.floor(limitRaw))) : 5;

        if (!query) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: 'query parameter cannot be empty',
            };
        }

        const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
            const response = await fetch(url, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'User-Agent': 'xqoder/1.0',
                    Accept: 'text/html,application/xhtml+xml',
                },
            });
            clearTimeout(timer);

            if (!response.ok) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Search failed: HTTP ${response.status}`,
                };
            }

            const html = await response.text();
            const results = extractSearchResultsFromHtml(html, limit);
            if (results.length === 0) {
                return {
                    toolCallId,
                    success: true,
                    output: `No search results found for: ${query}`,
                    metadata: {
                        query,
                        provider: 'duckduckgo-html',
                        resultCount: 0,
                    },
                };
            }

            const output = results
                .map((item, index) => `${index + 1}. ${item.title}\n   URL: ${item.url}${item.snippet ? `\n   Snippet: ${item.snippet}` : ''}`)
                .join('\n\n');

            return {
                toolCallId,
                success: true,
                output,
                metadata: {
                    query,
                    provider: 'duckduckgo-html',
                    resultCount: results.length,
                    results,
                },
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                toolCallId,
                success: false,
                output: '',
                error: `Websearch failed: ${message}`,
            };
        }
    }
}

// ---- HTML Processing Helpers ----

/**
 * Simple HTML -> Plain Text conversion
 * Removes all HTML tags, keeps text content
 */
function extractTextFromHtml(html: string): string {
    // Remove script/style tags and their content
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
 
    // Convert paragraphs and line breaks to newline characters
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
 
    // Remove all HTML tags
    text = text.replace(/<[^>]+>/g, '');
 
    // Decode common HTML entities
    text = decodeHtmlEntities(text);
 
    // Merge extra whitespace
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
 
    return text.trim();
}

/**
 * Simple HTML -> Markdown conversion
 */
function convertHtmlToBasicMarkdown(html: string): string {
    let md = html;
 
    // Remove script/style
    md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
 
    // Headers
    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
    md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
    md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
    md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');
 
    // Bold/Italic
    md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
    md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
 
    // Links
    md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
 
    // Code
    md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
    md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');
 
    // Lists
    md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
 
    // Paragraphs and line breaks
    md = md.replace(/<\/(p|div)>/gi, '\n\n');
    md = md.replace(/<br\s*\/?>/gi, '\n');
 
    // Remove remaining HTML tags
    md = md.replace(/<[^>]+>/g, '');
 
    // Decode HTML entities
    md = decodeHtmlEntities(md);
 
    // Clean up extra whitespace
    md = md.replace(/\n{3,}/g, '\n\n');
 
    return md.trim();
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function extractSearchResultsFromHtml(
    html: string,
    limit: number,
): Array<{ title: string; url: string; snippet?: string }> {
    const results: Array<{ title: string; url: string; snippet?: string }> = [];
    const itemRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>)?/gi;

    let match: RegExpExecArray | null = itemRegex.exec(html);
    while (match && results.length < limit) {
        const rawUrl = decodeHtmlEntities(match[1] ?? '').trim();
        const title = decodeHtmlEntities(stripHtml(match[2] ?? '')).trim();
        const snippetRaw = match[3] ?? match[4] ?? '';
        const snippet = decodeHtmlEntities(stripHtml(snippetRaw)).trim();

        if (title && rawUrl) {
            results.push({
                title,
                url: normalizeDuckDuckGoRedirect(rawUrl),
                ...(snippet ? { snippet } : {}),
            });
        }

        match = itemRegex.exec(html);
    }

    return results;
}

function stripHtml(value: string): string {
    return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeDuckDuckGoRedirect(rawUrl: string): string {
    try {
        const parsed = new URL(rawUrl, 'https://duckduckgo.com');
        if (parsed.pathname === '/l/' && parsed.searchParams.get('uddg')) {
            return decodeURIComponent(parsed.searchParams.get('uddg') ?? rawUrl);
        }
        return parsed.toString();
    } catch {
        return rawUrl;
    }
}
