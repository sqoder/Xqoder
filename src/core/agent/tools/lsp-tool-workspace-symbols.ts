import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import { ExternalLanguageServerManager } from '../lsp-manager.js';
import type { ITool, ToolContext } from './tool.js';
import { truncatePreview } from './diff.js';
import { clampResultLimit, getOrCreateTsContext } from './lsp-tool-typescript-context.js';
import { formatSymbolMatch } from './lsp-tool-formatters.js';

export class LspWorkspaceSymbolsTool implements ITool {
    constructor(private readonly externalManager?: ExternalLanguageServerManager) {}

    readonly definition: ToolDefinition = {
        name: 'lsp_workspace_symbols',
        description: 'Search for definitions in the current project by symbol name, supports built-in TypeScript/JavaScript and configured external LSP servers.',
        parameters: [
            { name: 'query', type: 'string', description: 'Symbol name fragment to search for', required: true },
            { name: 'limit', type: 'number', description: 'Maximum number of results to return (default 20)', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            const query = String(args['query'] ?? '').trim();
            if (!query) {
                throw new Error('query cannot be empty');
            }

            const limit = clampResultLimit(args['limit']);
            const service = getOrCreateTsContext(context.projectRoot);
            const matches = service.findWorkspaceSymbols(query, limit);
            const externalMatches = await this.externalManager?.listWorkspaceSymbols(query, limit) ?? [];
            const mergedMatches = [...matches, ...externalMatches].slice(0, limit);

            return {
                toolCallId,
                success: true,
                output: mergedMatches.length > 0
                    ? truncatePreview(mergedMatches.map(formatSymbolMatch).join('\n'))
                    : 'No matching symbols found',
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `LSP symbol search failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}
