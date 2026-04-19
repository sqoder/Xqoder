import * as path from 'node:path';
import type { LSPServerConfig } from '@xqoder/shared';
import { ExternalLanguageServerManager } from '../lsp-manager.js';
import { LspFileDiagnosticsTool } from './lsp-tool-diagnostics.js';
import { LspCompletionTool, LspHoverTool } from './lsp-tool-hover-completion.js';
import { LspDefinitionTool, LspReferencesTool } from './lsp-tool-navigation.js';
import { LspRenameSymbolTool } from './lsp-tool-rename.js';
import { LspWorkspaceSymbolsTool } from './lsp-tool-workspace-symbols.js';

export {
    LspWorkspaceSymbolsTool,
    LspFileDiagnosticsTool,
    LspDefinitionTool,
    LspReferencesTool,
    LspHoverTool,
    LspCompletionTool,
    LspRenameSymbolTool,
};

export interface LspToolOptions {
    externalManager?: ExternalLanguageServerManager;
    lspServers?: LSPServerConfig[];
    cwd?: string;
    projectRoot?: string;
}

export function createDefaultLspTools(options: LspToolOptions = {}): {
    workspaceSymbols: LspWorkspaceSymbolsTool;
    fileDiagnostics: LspFileDiagnosticsTool;
    definition: LspDefinitionTool;
    references: LspReferencesTool;
    hover: LspHoverTool;
    completion: LspCompletionTool;
    rename: LspRenameSymbolTool;
    externalManager?: ExternalLanguageServerManager;
} {
    const externalManager = options.externalManager ?? (
        (options.lspServers ?? []).some((server) => server.enabled !== false)
            ? new ExternalLanguageServerManager({
                servers: options.lspServers ?? [],
                cwd: path.resolve(options.cwd ?? options.projectRoot ?? process.cwd()),
                projectRoot: path.resolve(options.projectRoot ?? options.cwd ?? process.cwd()),
            })
            : undefined
    );

    return {
        workspaceSymbols: new LspWorkspaceSymbolsTool(externalManager),
        fileDiagnostics: new LspFileDiagnosticsTool(externalManager),
        definition: new LspDefinitionTool(externalManager),
        references: new LspReferencesTool(externalManager),
        hover: new LspHoverTool(externalManager),
        completion: new LspCompletionTool(externalManager),
        rename: new LspRenameSymbolTool(externalManager),
        externalManager,
    };
}
