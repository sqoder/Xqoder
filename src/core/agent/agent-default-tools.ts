import type { LLMProviderConfig, LSPServerConfig } from '@xqoder/shared';
import { feature } from '../../shared/feature-flags.js';
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
import {
    CronListTool,
    CronRemoveTool,
    ScheduleCronTool,
} from './tools/cron-tools.js';
import { EnterWorktreeTool, ExitWorktreeTool } from './tools/worktree-tools.js';
import {
    ReadMailboxTool,
    SendMessageTool,
    TeamCreateTool,
    TeamDeleteTool,
} from './tools/coordinator-tools.js';
import { DelegateTaskTool } from './tools/agent-tool.js';
import type { ToolContext, ToolRegistry, ITool } from './tools/tool.js';
// P27 utility tools
import {
    SleepTool,
    ConfigTool,
    BriefTool,
    SyntheticOutputTool,
    EnterPlanModeTool,
    ExitPlanModeTool,
    VerifyPlanExecutionTool,
    NotebookEditTool,
    AskUserQuestionTool,
    SuggestBackgroundPRTool,
} from './tools/p27-utility-tools.js';
// P27 feature-gated advanced tools
import {
    MonitorTool,
    ToolSearchTool,
    WorkflowTool,
    PowerShellTool,
    RemoteTriggerTool,
    REPLTool,
} from './tools/p27-advanced-tools.js';

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
    input.toolRegistry.register(new ScheduleCronTool());
    input.toolRegistry.register(new CronListTool());
    input.toolRegistry.register(new CronRemoveTool());
    input.toolRegistry.register(new EnterWorktreeTool());
    input.toolRegistry.register(new ExitWorktreeTool());
    input.toolRegistry.register(new TeamCreateTool());
    input.toolRegistry.register(new TeamDeleteTool());
    input.toolRegistry.register(new SendMessageTool());
    input.toolRegistry.register(new ReadMailboxTool());
    input.toolRegistry.register(new DelegateTaskTool(input.llmConfig, input.toolRegistry));

    // P27 — utility tools (always registered)
    input.toolRegistry.register(new SleepTool());
    input.toolRegistry.register(new ConfigTool());
    input.toolRegistry.register(new BriefTool());
    input.toolRegistry.register(new SyntheticOutputTool());
    input.toolRegistry.register(new EnterPlanModeTool());
    input.toolRegistry.register(new ExitPlanModeTool());
    input.toolRegistry.register(new VerifyPlanExecutionTool());
    input.toolRegistry.register(new NotebookEditTool());
    input.toolRegistry.register(new AskUserQuestionTool());
    input.toolRegistry.register(new SuggestBackgroundPRTool());

    // P27 — feature-gated advanced tools
    if (feature('MONITOR_TOOL')) {
        input.toolRegistry.register(new MonitorTool());
    }
    if (feature('WORKFLOW_SCRIPTS')) {
        input.toolRegistry.register(new WorkflowTool());
    }
    if (feature('REPL_TOOL')) {
        input.toolRegistry.register(new REPLTool());
    }
    if (feature('POWERSHELL_TOOL') && process.platform === 'win32') {
        input.toolRegistry.register(new PowerShellTool());
    }
    if (feature('REMOTE_TRIGGER_TOOL')) {
        input.toolRegistry.register(new RemoteTriggerTool());
    }
    if (feature('TOOL_SEARCH_LAZY')) {
        const summaries = input.toolRegistry.getTools().map((t: ITool) => ({
            name: t.definition.name,
            description: t.definition.description ?? '',
        }));
        input.toolRegistry.register(new ToolSearchTool(summaries));
    }
}
