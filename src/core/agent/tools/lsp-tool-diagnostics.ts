import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import { ExternalLanguageServerManager } from '../lsp-manager.js';
import type { ITool, ToolContext } from './tool.js';
import { truncatePreview } from './diff.js';
import { resolvePathForRead } from './sandbox.js';
import { getOrCreateTsContext } from './lsp-tool-typescript-context.js';
import { formatDiagnosticMatch } from './lsp-tool-formatters.js';

export class LspFileDiagnosticsTool implements ITool {
    constructor(private readonly externalManager?: ExternalLanguageServerManager) {}

    readonly persistLargeResult = false;

    readonly definition: ToolDefinition = {
        name: 'lsp_file_diagnostics',
        description: 'Get file diagnostic information, supports built-in TypeScript/JavaScript and configured external LSP servers.',
        parameters: [
            { name: 'path', type: 'string', description: 'Target file path', required: true },
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
            const diagnostics = await this.getDiagnostics(filePath, context.projectRoot);

            return {
                toolCallId,
                success: true,
                output: diagnostics.length > 0
                    ? truncatePreview(diagnostics.map(formatDiagnosticMatch).join('\n'))
                    : `No diagnostics found: ${filePath}`,
                metadata: {
                    path: filePath,
                },
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `LSP diagnostics failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    private async getDiagnostics(filePath: string, projectRoot: string) {
        if (this.externalManager?.hasServerForFile(filePath)) {
            return this.externalManager.getFileDiagnostics(filePath);
        }

        const service = getOrCreateTsContext(projectRoot);
        return service.getFileDiagnostics(filePath);
    }
}
