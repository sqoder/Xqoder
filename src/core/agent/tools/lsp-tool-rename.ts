import * as fs from 'node:fs';
import type { ToolApprovalRequest, ToolContext, ITool } from './tool.js';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { RenameMatch as LspRenameMatch } from '../lsp.js';
import { ExternalLanguageServerManager } from '../lsp-manager.js';
import { createFileDiffPreview, truncatePreview } from './diff.js';
import { resolvePathWithinProject } from './sandbox.js';
import {
    applyTextEditsToContent,
    getOrCreateTsContext,
    groupTextEditsByFile,
} from './lsp-tool-typescript-context.js';

export { applyTextEditsToContent, groupTextEditsByFile } from './lsp-tool-typescript-context.js';

export class LspRenameSymbolTool implements ITool {
    constructor(private readonly externalManager?: ExternalLanguageServerManager) {}

    readonly definition: ToolDefinition = {
        name: 'lsp_rename_symbol',
        description: 'Rename a symbol at a file position, supports built-in TypeScript/JavaScript and configured external LSP servers.',
        parameters: [
            { name: 'path', type: 'string', description: 'Target file path', required: true },
            { name: 'line', type: 'number', description: '1-based line number', required: true },
            { name: 'character', type: 'number', description: '1-based character column', required: true },
            { name: 'newName', type: 'string', description: 'New symbol name', required: true },
        ],
    };

    async buildApprovalRequest(
        args: Record<string, unknown>,
        context: ToolContext,
    ): Promise<ToolApprovalRequest | undefined> {
        const renamePlan = await this.prepareRenamePlan(args, context);
        if (!renamePlan) {
            return undefined;
        }

        return {
            toolCallId: '',
            toolName: 'lsp_rename_symbol',
            summary: `Rename symbol to ${renamePlan.newName} in ${renamePlan.filePaths.length} files`,
            reason: 'This operation will update code references in bulk; diff must be confirmed before execution.',
            preview: truncatePreview(renamePlan.preview),
            risk: 'high',
        };
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            const renamePlan = await this.prepareRenamePlan(args, context);
            if (!renamePlan) {
                throw new Error('No rename edits generated');
            }

            const rollbackPoint = context.rollbackStore?.createPoint({
                sessionId: context.sessionId,
                projectRoot: context.projectRoot,
                toolName: 'lsp_rename_symbol',
                filePaths: renamePlan.filePaths,
            });

            for (const [filePath, nextContent] of renamePlan.updatedContents.entries()) {
                fs.writeFileSync(filePath, nextContent, 'utf-8');
            }

            const outputLines = [
                `Symbol renamed to ${renamePlan.newName}`,
                `Affected files: ${renamePlan.filePaths.join(', ')}`,
                `Total edits: ${renamePlan.totalEdits}`,
            ];
            if (rollbackPoint) {
                outputLines.push(`Rollback point: ${rollbackPoint.id}`);
            }

            return {
                toolCallId,
                success: true,
                output: outputLines.join('\n'),
                metadata: {
                    filePaths: renamePlan.filePaths,
                    totalEdits: renamePlan.totalEdits,
                    changeType: 'rename',
                    newName: renamePlan.newName,
                    ...(rollbackPoint ? { rollbackPointId: rollbackPoint.id } : {}),
                },
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `LSP rename failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    private async prepareRenamePlan(
        args: Record<string, unknown>,
        context: ToolContext,
    ): Promise<{
        filePaths: string[];
        updatedContents: Map<string, string>;
        preview: string;
        totalEdits: number;
        newName: string;
    } | null> {
        const filePath = resolvePathWithinProject(args['path'] as string, context);
        const newName = String(args['newName'] ?? '').trim();
        if (!newName) {
            throw new Error('newName cannot be empty');
        }

        const renameMatch = await this.renameSymbol(
            filePath,
            Number(args['line']),
            Number(args['character']),
            newName,
            context.projectRoot,
        );

        if (!renameMatch || renameMatch.edits.length === 0) {
            return null;
        }

        const updatedContents = new Map<string, string>();
        const previews: string[] = [];
        const groupedEdits = groupTextEditsByFile(renameMatch.edits);

        for (const [entryPath, edits] of groupedEdits.entries()) {
            const resolvedPath = resolvePathWithinProject(entryPath, context);
            const currentContent = fs.readFileSync(resolvedPath, 'utf-8');
            const nextContent = applyTextEditsToContent(currentContent, edits);
            updatedContents.set(resolvedPath, nextContent);
            previews.push(createFileDiffPreview(resolvedPath, currentContent, nextContent));
        }

        return {
            filePaths: Array.from(updatedContents.keys()),
            updatedContents,
            preview: previews.join('\n\n'),
            totalEdits: renameMatch.totalEdits,
            newName,
        };
    }

    private async renameSymbol(
        filePath: string,
        line: number,
        character: number,
        newName: string,
        projectRoot: string,
    ): Promise<LspRenameMatch | null> {
        if (this.externalManager?.hasServerForFile(filePath)) {
            return this.externalManager.renameSymbol(filePath, line, character, newName);
        }

        const service = getOrCreateTsContext(projectRoot);
        return service.renameSymbol(filePath, line, character, newName);
    }
}
