import type { Logger, LSPServerConfig } from '@xqoder/shared';

export interface LspManagerOptions {
    servers: LSPServerConfig[];
    cwd: string;
    projectRoot: string;
    logger?: Logger;
}

export interface WorkspaceSymbolMatch {
    kind: string;
    name: string;
    filePath: string;
    line: number;
    character: number;
    preview: string;
    containerName?: string;
}

export interface DiagnosticMatch {
    severity: string;
    code: string;
    filePath: string;
    line: number;
    character: number;
    message: string;
}

export interface LocationMatch {
    filePath: string;
    line: number;
    character: number;
    preview: string;
    kind?: string;
}

export interface HoverMatch {
    contents: string;
    range?: {
        line: number;
        character: number;
        endLine: number;
        endCharacter: number;
    };
}

export interface CompletionMatch {
    label: string;
    kind?: string;
    detail?: string;
    documentation?: string;
    insertText?: string;
    sortText?: string;
    resolved?: boolean;
}

export interface TextEditMatch {
    filePath: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
    newText: string;
}

export interface RenameMatch {
    filePaths: string[];
    edits: TextEditMatch[];
    totalEdits: number;
    placeholder?: string;
}

export interface LspServerCapabilities {
    workspaceSymbols: boolean;
    definition: boolean;
    references: boolean;
    diagnostics: boolean;
    hover: boolean;
    completion: boolean;
    completionResolve: boolean;
    rename: boolean;
}

export interface LspServerInspection {
    name: string;
    enabled: boolean;
    status: 'ok' | 'error' | 'disabled';
    transport: 'stdio' | 'tcp';
    command?: string;
    args: string[];
    host?: string;
    port?: number;
    cwd?: string;
    extensions: string[];
    languageId?: string;
    serverInfo?: {
        name: string;
        version?: string;
    };
    capabilities: LspServerCapabilities;
    error?: string;
}
