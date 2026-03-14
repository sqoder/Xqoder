// ============================================================
// Fetch 工具 — 从 URL 获取内容
// 参考 OpenCode: internal/llm/tools/fetch.go
// ============================================================

import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolApprovalRequest, ToolContext } from './tool.js';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

/**
 * FetchUrlTool
 * 从 URL 获取内容并以指定格式返回（text / markdown / html）
 */
export class FetchUrlTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'fetch_url',
        description: [
            '从 URL 获取内容并返回。',
            '支持三种输出格式：text（提取纯文本）、markdown（HTML 转 Markdown）、html（原始 HTML）。',
            '适用于获取文档、API 响应或网页内容。',
            '限制：最大响应 5MB，仅支持 HTTP/HTTPS，不支持身份验证。',
        ].join('\n'),
        parameters: [
            { name: 'url', type: 'string', description: '要获取内容的 URL', required: true },
            {
                name: 'format',
                type: 'string',
                description: '返回内容的格式：text、markdown 或 html',
                required: false,
                default: 'text',
            },
            {
                name: 'timeout',
                type: 'number',
                description: '请求超时秒数（最大 120）',
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
            reason: '网络请求可能发送数据到外部服务器',
            risk: 'medium',
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

        // 验证 URL
        if (!url) {
            return { toolCallId, success: false, output: '', error: 'URL 参数不能为空' };
        }

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return { toolCallId, success: false, output: '', error: 'URL 必须以 http:// 或 https:// 开头' };
        }

        if (!['text', 'markdown', 'html'].includes(format)) {
            return { toolCallId, success: false, output: '', error: 'format 必须为 text、markdown 或 html' };
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

            // 检查 Content-Length
            const contentLength = response.headers.get('content-length');
            if (contentLength && Number(contentLength) > MAX_RESPONSE_SIZE) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `响应体过大: ${contentLength} bytes（上限 5MB）`,
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

            // 截断过长输出
            if (output.length > 100_000) {
                output = output.slice(0, 100_000) + '\n\n... [内容已截断，原始长度: ' + output.length + ' 字符]';
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
                    ? `请求超时（${timeoutSec}s）: ${url}`
                    : `获取失败: ${message}`,
            };
        }
    }
}

/**
 * WebSearchTool
 * 使用 DuckDuckGo HTML 搜索页进行无 key 的轻量搜索。
 */
export class WebSearchTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'websearch',
        description: [
            '搜索互联网公开信息并返回结构化结果。',
            '默认使用 DuckDuckGo HTML 搜索，无需 API Key。',
            '参数支持 query 和 limit（默认 5，最大 10）。',
        ].join('\n'),
        parameters: [
            { name: 'query', type: 'string', description: '搜索关键词', required: true },
            { name: 'limit', type: 'number', description: '返回结果数量（1-10）', required: false, default: 5 },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>): ToolApprovalRequest {
        const query = String(args['query'] ?? '');
        return {
            toolCallId: String(args['toolCallId'] ?? ''),
            toolName: this.definition.name,
            summary: `Search web for: ${query}`,
            reason: '网络搜索会请求外部搜索引擎',
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
                error: 'query 参数不能为空',
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
                    error: `搜索失败: HTTP ${response.status}`,
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
                error: `websearch 失败: ${message}`,
            };
        }
    }
}

// ---- HTML 处理辅助函数 ----

/**
 * 简易 HTML → 纯文本转换
 * 移除所有 HTML 标签，保留文本内容
 */
function extractTextFromHtml(html: string): string {
    // 移除 script/style 标签及其内容
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // 段落和换行转为换行符
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');

    // 移除所有 HTML 标签
    text = text.replace(/<[^>]+>/g, '');

    // 解码常见 HTML 实体
    text = decodeHtmlEntities(text);

    // 合并多余空白
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
}

/**
 * 简易 HTML → Markdown 转换
 */
function convertHtmlToBasicMarkdown(html: string): string {
    let md = html;

    // 移除 script/style
    md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // 标题
    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
    md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
    md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
    md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

    // 加粗/斜体
    md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
    md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

    // 链接
    md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

    // 代码
    md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
    md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

    // 列表
    md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');

    // 段落和换行
    md = md.replace(/<\/(p|div)>/gi, '\n\n');
    md = md.replace(/<br\s*\/?>/gi, '\n');

    // 移除剩余 HTML 标签
    md = md.replace(/<[^>]+>/g, '');

    // 解码 HTML 实体
    md = decodeHtmlEntities(md);

    // 清理多余空白
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
