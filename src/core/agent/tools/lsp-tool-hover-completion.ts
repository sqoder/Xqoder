import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import { ExternalLanguageServerManager } from '../lsp-manager.js';
import type { ITool, ToolContext } from './tool.js';
import { truncatePreview } from './diff.js';
import { resolvePathForRead } from './sandbox.js';
import {
    clampResolveLimit,
    clampResultLimit,
    getOrCreateTsContext,
    parseBooleanArg,
} from './lsp-tool-typescript-context.js';
import { formatCompletionMatch, formatHoverMatch } from './lsp-tool-formatters.js';

export class LspHoverTool implements ITool {
    constructor(private readonly externalManager?: ExternalLanguageServerManager) {}

    readonly persistLargeResult = false;

    readonly definition: ToolDefinition = {
        name: 'lsp_hover',
        description: 'Read hover information at a file position, supports built-in TypeScript/JavaScript and configured external LSP servers.',
        parameters: [
            { name: 'path', type: 'string', description: 'Target file path', required: true },
            { name: 'line', type: 'number', description: '1-based line number', required: true },
            { name: 'character', type: 'number', description: '1-based column number', required: true },
        ],
    };

    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return true;
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            const filePath = resolvePathForRead(args['path'] as string, context);
            const match = await this.getHover(
                filePath,
                Number(args['line']),
                Number(args['character']),
                context.projectRoot,
            );

            return {
                toolCallId,
                success: true,
                output: match
                    ? truncatePreview(formatHoverMatch(match))
                    : 'No hover information found',
                metadata: {
                    path: filePath,
                },
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `LSP hover query failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    private async getHover(
        filePath: string,
        line: number,
        character: number,
        projectRoot: string,
    ) {
        if (this.externalManager?.hasServerForFile(filePath)) {
            return this.externalManager.getHover(filePath, line, character);
        }

        const service = getOrCreateTsContext(projectRoot);
        return service.getHover(filePath, line, character);
    }
}

export class LspCompletionTool implements ITool {
    constructor(private readonly externalManager?: ExternalLanguageServerManager) {}

    readonly persistLargeResult = false;

    readonly definition: ToolDefinition = {
        name: 'lsp_completion',
        description: 'Read completion candidates at a file position, supports built-in TypeScript/JavaScript and configured external LSP servers.',
        parameters: [
            { name: 'path', type: 'string', description: 'Target file path', required: true },
            { name: 'line', type: 'number', description: '1-based line number', required: true },
            { name: 'character', type: 'number', description: '1-based character column', required: true },
            { name: 'limit', type: 'number', description: 'Maximum number of results to return (default 20)', required: false },
            { name: 'resolveDetails', type: 'boolean', description: 'Whether to resolve completion item details for the first few candidates', required: false },
            { name: 'resolveLimit', type: 'number', description: 'Maximum number of items to resolve (default 5)', required: false },
        ],
    };

    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return true;
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            const filePath = resolvePathForRead(args['path'] as string, context);
            const matches = await this.getCompletions(
                filePath,
                Number(args['line']),
                Number(args['character']),
                clampResultLimit(args['limit']),
                parseBooleanArg(args['resolveDetails']),
                clampResolveLimit(args['resolveLimit']),
                context.projectRoot,
            );

            return {
                toolCallId,
                success: true,
                output: matches.length > 0
                    ? truncatePreview(matches.map(formatCompletionMatch).join('\n'))
                    : 'No completion candidates found',
                metadata: {
                    path: filePath,
                },
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `LSP completion query failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    private async getCompletions(
        filePath: string,
        line: number,
        character: number,
        limit: number,
        resolveDetails: boolean,
        resolveLimit: number,
        projectRoot: string,
    ) {
        if (this.externalManager?.hasServerForFile(filePath)) {
            return this.externalManager.getCompletions(
                filePath,
                line,
                character,
                limit,
                resolveDetails,
                resolveLimit,
            );
        }

        const service = getOrCreateTsContext(projectRoot);
        return service.getCompletions(filePath, line, character, limit, resolveDetails, resolveLimit);
    }
}
