import type { LLMProviderConfig, LSPServerConfig } from '@xqoder/shared';
import type { ExternalLanguageServerManager } from './lsp-manager.js';
import { DiagnosticsTool } from './tools/diagnostics-tool.js';
import { ListFilesTool, GlobFilesTool, GrepContentTool } from './tools/discovery-tools.js';
import { FetchUrlTool, WebSearchTool } from './tools/fetch-tool.js';
import { ReadFileTool, WriteFileTool, PreviewDiffTool, SearchCodeTool } from './tools/file-tools.js';
import { createDefaultLspTools } from './tools/lsp-tools.js';
import { ApplyPatchTool, RestoreRollbackPointTool } from './tools/patch-tool.js';
import { SourcegraphTool } from './tools/sourcegraph-tool.js';
import { RunCommandTool, InstallPackageTool } from './tools/command-tool.js';
import { QuestionTool, SkillTool, TodoReadTool, TodoWriteTool } from './tools/interaction-tools.js';
import { DelegateTaskTool } from './tools/agent-tool.js';
import type { ToolContext, ToolRegistry } from './tools/tool.js';

export interface DefaultAgentToolRegistrationInput {
    toolRegistry: ToolRegistry;
    toolContext: ToolContext;
    llmConfig: LLMProviderConfig;
    lspManager?: ExternalLanguageServerManager;
    lspServers?: LSPServerConfig[];
}

export function registerDefaultAgentTools(input: DefaultAgentToolRegistrationInput): void {
    input.toolRegistry.register(new ReadFileTool());
    input.toolRegistry.register(new WriteFileTool());
    input.toolRegistry.register(new PreviewDiffTool());
    input.toolRegistry.register(new SearchCodeTool());
    input.toolRegistry.register(new ListFilesTool());
    input.toolRegistry.register(new GlobFilesTool());
    input.toolRegistry.register(new GrepContentTool());
    input.toolRegistry.register(new SourcegraphTool());

    const lspTools = createDefaultLspTools({
        externalManager: input.lspManager,
        lspServers: input.lspServers ?? [],
        cwd: input.toolContext.cwd,
        projectRoot: input.toolContext.projectRoot,
    });
    input.toolRegistry.register(lspTools.workspaceSymbols);
    input.toolRegistry.register(lspTools.fileDiagnostics);
    input.toolRegistry.register(lspTools.definition);
    input.toolRegistry.register(lspTools.references);
    input.toolRegistry.register(lspTools.hover);
    input.toolRegistry.register(lspTools.completion);
    input.toolRegistry.register(lspTools.rename);

    input.toolRegistry.register(new RunCommandTool());
    input.toolRegistry.register(new InstallPackageTool());
    input.toolRegistry.register(new ApplyPatchTool());
    input.toolRegistry.register(new RestoreRollbackPointTool());
    input.toolRegistry.register(new FetchUrlTool());
    input.toolRegistry.register(new WebSearchTool());
    input.toolRegistry.register(new SkillTool());
    input.toolRegistry.register(new TodoWriteTool());
    input.toolRegistry.register(new TodoReadTool());
    input.toolRegistry.register(new QuestionTool());
    input.toolRegistry.register(new DiagnosticsTool());
    input.toolRegistry.register(new DelegateTaskTool(input.llmConfig, input.toolRegistry));
}
