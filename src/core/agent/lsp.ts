import type { LspManagerOptions, LspServerInspection } from './lsp-types.js';
import { inspectLspServers as inspectLspServersWithClient } from './lsp-inspection.js';
import { createStdioLanguageServerClient } from './lsp-client.js';
export type {
    CompletionMatch,
    DiagnosticMatch,
    HoverMatch,
    LocationMatch,
    LspManagerOptions,
    LspServerCapabilities,
    LspServerInspection,
    RenameMatch,
    TextEditMatch,
    WorkspaceSymbolMatch,
} from './lsp-types.js';
export { createStdioLanguageServerClient } from './lsp-client.js';

export async function inspectLspServers(options: LspManagerOptions): Promise<LspServerInspection[]> {
    return inspectLspServersWithClient(options, createStdioLanguageServerClient);
}
