import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import { ExternalLanguageServerManager } from '../lsp-manager.js';
import type { ITool, ToolContext } from './tool.js';
import { truncatePreview } from './diff.js';
import { resolvePathForRead } from './sandbox.js';
import { clampResultLimit, getOrCreateTsContext } from './lsp-tool-typescript-context.js';
import { formatLocationMatch } from './lsp-tool-formatters.js';

export class LspDefinitionTool implements ITool {
    constructor(private readonly externalManager?: ExternalLanguageServerManager) {}

    readonly persistLargeResult = false;

    readonly definition: ToolDefinition = {
        name: 'lsp_definition',
        description: 'Jump to symbol definition based on file position, supports built-in TypeScript/JavaScript and configured external LSP servers.',
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
            const matches = await this.findDefinitions(
                filePath,
                Number(args['line']),
                Number(args['character']),
                context.projectRoot,
            );

            return {
                toolCallId,
                success: true,
                output: matches.length > 0
                    ? truncatePreview(matches.map(formatLocationMatch).join('\n'))
                    : 'No definition found',
                metadata: {
                    path: filePath,
                },
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `LSP definition query failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    private async findDefinitions(
        filePath: string,
        line: number,
        character: number,
        projectRoot: string,
    ) {
        if (this.externalManager?.hasServerForFile(filePath)) {
            return this.externalManager.findDefinitions(filePath, line, character);
        }

        const service = getOrCreateTsContext(projectRoot);
        return service.findDefinitions(filePath, line, character);
    }
}

export class LspReferencesTool implements ITool {
    constructor(private readonly externalManager?: ExternalLanguageServerManager) {}

    readonly persistLargeResult = false;

    readonly definition: ToolDefinition = {
        name: 'lsp_references',
        description: 'Find symbol references based on file position, supports built-in TypeScript/JavaScript and configured external LSP servers.',
        parameters: [
            { name: 'path', type: 'string', description: 'Target file path', required: true },
            { name: 'line', type: 'number', description: '1-based line number', required: true },
            { name: 'character', type: 'number', description: '1-based character column', required: true },
            { name: 'limit', type: 'number', description: 'Maximum number of results to return (default 20)', required: false },
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
            const matches = await this.findReferences(
                filePath,
                Number(args['line']),
                Number(args['character']),
                clampResultLimit(args['limit']),
                context.projectRoot,
            );

            return {
                toolCallId,
                success: true,
                output: matches.length > 0
                    ? truncatePreview(matches.map(formatLocationMatch).join('\n'))
                    : 'No references found',
                metadata: {
                    path: filePath,
                },
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `LSP reference search failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    private async findReferences(
        filePath: string,
        line: number,
        character: number,
        limit: number,
        projectRoot: string,
    ) {
        if (this.externalManager?.hasServerForFile(filePath)) {
            return this.externalManager.findReferences(filePath, line, character, limit);
        }

        const service = getOrCreateTsContext(projectRoot);
        return service.findReferences(filePath, line, character, limit);
    }
}
