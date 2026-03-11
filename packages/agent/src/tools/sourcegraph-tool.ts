// ============================================================
// SourcegraphTool - 搜索公共仓库代码的工具
// ============================================================

import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolContext } from './tool.js';

export interface SourcegraphParams {
    query: string;
    count?: number;
    context_window?: number;
    timeout?: number;
}

export class SourcegraphTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'sourcegraph',
        description: `Search code across public repositories using Sourcegraph's GraphQL API.
WHEN TO USE: Find code examples, implementations, patterns and best practices in open source code.
QUERY SYNTAX: 
- "fmt.Println" (exact matches)
- "file:.go fmt.Println" (Go files)
- "repo:^github\.com/golang/go$ fmt.Println" (specific repo)
- "lang:go fmt.Println" (Go language)
- "-file:test" (exclude filters)
- "type:symbol" (search for symbols)
LIMITATIONS: Max 20 results per query.`,
        parameters: [
            {
                name: 'query',
                type: 'string',
                description: 'The Sourcegraph search query (e.g. "repo:github.com/kubernetes/kubernetes file:.go client")',
                required: true,
            },
            {
                name: 'count',
                type: 'number',
                description: 'Optional number of results to return (default: 10, max: 20)',
                required: false,
            },
            {
                name: 'context_window',
                type: 'number',
                description: 'The context around the match to return (default: 10 lines)',
                required: false,
            },
            {
                name: 'timeout',
                type: 'number',
                description: 'Optional timeout in seconds (max 120)',
                required: false,
            },
        ],
    };

    /** 执行 Sourcegraph 工具 */
    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const query = args['query'] as string;
        if (!query) {
            return {
                toolCallId: String(args['toolCallId']),
                success: false,
                output: '',
                error: 'Query parameter is required',
            };
        }

        const count = Math.min(Math.max((args['count'] as number) || 10, 1), 20);
        const contextWindow = Math.max((args['context_window'] as number) || 10, 1);
        const timeout = Math.min(Math.max((args['timeout'] as number) || 30, 1), 120);

        try {
            const graphqlQuery = {
                query: `query Search($query: String!) { search(query: $query, version: V2, patternType: keyword) { results { matchCount, limitHit, resultCount, approximateResultCount, missing { name }, timedout { name }, indexUnavailable, results { __typename, ... on FileMatch { repository { name }, file { path, url, content }, lineMatches { preview, lineNumber, offsetAndLengths } } } } } }`,
                variables: { query },
            };

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

            const res = await fetch('https://sourcegraph.com/.api/graphql', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'xqoder/1.0',
                },
                body: JSON.stringify(graphqlQuery),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                const text = await res.text().catch(() => '');
                return {
                    toolCallId: String(args['toolCallId']),
                    success: false,
                    output: '',
                    error: `Request failed with status code: ${res.status}, response: ${text}`,
                };
            }

            const data = await res.json() as Record<string, any>;
            const formatted = this.formatSourcegraphResults(data, contextWindow);

            return {
                toolCallId: String(args['toolCallId']),
                success: true,
                output: formatted,
            };
        } catch (err) {
            return {
                toolCallId: String(args['toolCallId']),
                success: false,
                output: '',
                error: `Failed to execute Sourcegraph query: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    /** 格式化 Sourcegraph 查询结果 */
    private formatSourcegraphResults(result: Record<string, any>, contextWindow: number): string {
        let buffer = '';

        if (Array.isArray(result['errors']) && result['errors'].length > 0) {
            buffer += '## Sourcegraph API Error\n\n';
            for (const err of result['errors']) {
                if (err && typeof err === 'object' && typeof err.message === 'string') {
                    buffer += `- ${err.message}\n`;
                }
            }
            return buffer;
        }

        const data = result['data'];
        if (!data || !data.search || !data.search.results) {
            return 'Invalid response format from Sourcegraph API';
        }

        const searchResults = data.search.results;
        const matchCount = Number(searchResults.matchCount) || 0;
        const resultCount = Number(searchResults.resultCount) || 0;
        const limitHit = Boolean(searchResults.limitHit);

        buffer += '# Sourcegraph Search Results\n\n';
        buffer += `Found ${matchCount} matches across ${resultCount} results\n`;
        if (limitHit) {
            buffer += '(Result limit reached, try a more specific query)\n';
        }
        buffer += '\n';

        const results = searchResults.results;
        if (!Array.isArray(results) || results.length === 0) {
            buffer += 'No results found. Try a different query.\n';
            return buffer;
        }

        // Limit to top 10 results for LLM context window
        const topResults = results.slice(0, 10);

        topResults.forEach((res, index) => {
            if (res.__typename !== 'FileMatch') return;

            const repoName = res.repository?.name || 'unknown-repo';
            const filePath = res.file?.path || 'unknown-file';
            const fileURL = res.file?.url || '';
            const fileContent = res.file?.content || '';
            const lineMatches = res.lineMatches || [];

            buffer += `## Result ${index + 1}: ${repoName}/${filePath}\n\n`;
            if (fileURL) {
                buffer += `URL: ${fileURL}\n\n`;
            }

            if (lineMatches.length > 0) {
                for (const match of lineMatches) {
                    const lineNumber = Number(match.lineNumber) || 0;
                    const preview = match.preview || '';

                    if (fileContent) {
                        const lines = fileContent.split('\n');
                        buffer += '```\n';

                        const startLine = Math.max(1, lineNumber - contextWindow);
                        for (let j = startLine - 1; j < lineNumber - 1 && j < lines.length; j++) {
                            if (j >= 0) {
                                buffer += `${j + 1}| ${lines[j]}\n`;
                            }
                        }

                        buffer += `${lineNumber}|  ${preview}\n`;

                        const endLine = lineNumber + contextWindow;
                        for (let j = lineNumber; j < endLine && j < lines.length; j++) {
                            buffer += `${j + 1}| ${lines[j]}\n`;
                        }

                        buffer += '```\n\n';
                    } else {
                        buffer += '```\n';
                        buffer += `${lineNumber}| ${preview}\n`;
                        buffer += '```\n\n';
                    }
                }
            }
        });

        return buffer;
    }
}
