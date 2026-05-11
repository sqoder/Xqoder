import type { LLMProviderConfig, LSPServerConfig } from '@xqoder/shared';
import type { ExternalLanguageServerManager } from './lsp-manager.js';
import type { AgentRuntimeProfile } from './mvp/types.js';
import { DiagnosticsTool } from './tools/diagnostics-tool.js';
import { ListFilesTool, GlobFilesTool, GrepContentTool, DiscoverSkillsTool } from './tools/discovery-tools.js';
import { FetchUrlTool, WebSearchTool } from './tools/fetch-tool.js';
import { InspectGitHubRepoTool } from './tools/github-repo-tool.js';
import { ReadFileTool, WriteFileTool, EditFileTool, PreviewDiffTool, SearchCodeTool } from './tools/file-tools.js';
import { ReadAnyFileTool } from './tools/read-any-file/index.js';
import { createDefaultLspTools } from './tools/lsp-tools.js';
import { ApplyPatchTool, RestoreRollbackPointTool } from './tools/patch-tool.js';
import { SourcegraphTool } from './tools/sourcegraph-tool.js';
import { RunCommandTool, RunShellTool, InstallPackageTool } from './tools/command-tool.js';
import { QuestionTool, SkillTool, TodoReadTool, TodoWriteTool } from './tools/interaction-tools.js';
import {
    TaskCreateTool,
    TaskGetTool,
    TaskListTool,
    TaskOutputTool,
    TaskStopTool,
    TaskUpdateTool,
} from './tools/task-tools.js';
import { DelegateTaskTool } from './tools/agent-tool.js';
import type { ToolContext, ToolRegistry } from './tools/tool.js';

export interface DefaultAgentToolRegistrationInput {
    toolRegistry: ToolRegistry;
    toolContext: ToolContext;
    llmConfig: LLMProviderConfig;
    lspManager?: ExternalLanguageServerManager;
    lspServers?: LSPServerConfig[];
    profile?: AgentRuntimeProfile;
}

export function registerDefaultAgentTools(input: DefaultAgentToolRegistrationInput): void {
    input.toolRegistry.register(new ReadFileTool());
    input.toolRegistry.register(new ReadAnyFileTool());
    input.toolRegistry.register(new WriteFileTool());
    input.toolRegistry.register(new EditFileTool());
    input.toolRegistry.register(new SearchCodeTool());
    if (input.profile === 'mvp') {
        input.toolRegistry.register(new ListFilesTool());
        input.toolRegistry.register(new GlobFilesTool());
        input.toolRegistry.register(new GrepContentTool());
        input.toolRegistry.register(new SourcegraphTool());
        input.toolRegistry.register(new InspectGitHubRepoTool());
        input.toolRegistry.register(new FetchUrlTool());
        input.toolRegistry.register(new WebSearchTool());
        input.toolRegistry.register(new RunShellTool());
        return;
    }

    input.toolRegistry.register(new PreviewDiffTool());
    input.toolRegistry.register(new ListFilesTool());
    input.toolRegistry.register(new GlobFilesTool());
    input.toolRegistry.register(new GrepContentTool());
    input.toolRegistry.register(new SourcegraphTool());
    input.toolRegistry.register(new InspectGitHubRepoTool());

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
    input.toolRegistry.register(new DiscoverSkillsTool());
    input.toolRegistry.register(new TaskCreateTool());
    input.toolRegistry.register(new TaskListTool());
    input.toolRegistry.register(new TaskGetTool());
    input.toolRegistry.register(new TaskOutputTool());
    input.toolRegistry.register(new TaskStopTool());
    input.toolRegistry.register(new TaskUpdateTool());
    input.toolRegistry.register(new DelegateTaskTool(input.llmConfig, input.toolRegistry));
}
