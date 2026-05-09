import { configManager, type ConfigManager, resolveDefaultAgentName } from '@xqoder/shared';
import {
    SummarizerAgent,
    XQoderAgent,
    getBuiltInAgentDefinition,
    listBuiltInAgents,
    listMarkdownAgents,
} from '@xqoder/agent';
import {
    createConversationEventEnvelopeEmitter,
} from '@xqoder/protocol';
import type {
    AppEvent,
    ConversationEventEnvelope,
} from '@xqoder/protocol';
import {
    createPermissionsSnapshot,
    formatPermissionsSnapshot,
} from '../system/permissions.js';
import { createNotepadSnapshot } from '../system/notepad.js';
import { createConfigDoctorReport } from '../config/doctor.js';
import { formatSessionUsageSummary } from '../../shared/session-usage.js';
import type {
    ChatTurnIntakeDependencies,
    PreparedChatExecution,
} from './turn-intake.js';

export interface DirectChatCommandDependencies extends ChatTurnIntakeDependencies {
    listVisibleTools?: (
        execution: PreparedChatExecution,
    ) => Promise<Array<{ name: string; description?: string; permissionMode: string }>>;
    compactSession?: (
        execution: PreparedChatExecution,
    ) => Promise<string | null | undefined>;
}

export async function resolveDirectChatCommandResponse(
    execution: PreparedChatExecution,
    dependencies: DirectChatCommandDependencies = {},
): Promise<string | undefined> {
    const commandRoute = execution.turnInput.runtime.commandRoute;
    switch (commandRoute.kind) {
        case 'status':
            return buildStatusResponse(execution);
        case 'permissions':
            return buildPermissionsResponse(execution, dependencies);
        case 'tools':
            return await buildToolsResponse(execution, dependencies);
        case 'compact':
            return await buildCompactResponse(execution, dependencies);
        case 'model':
            return buildModelResponse(execution);
        case 'doctor':
            return await buildDoctorResponse(execution, dependencies);
        case 'cost':
            return buildCostResponse(execution);
        case 'agents':
            return buildAgentsResponse(execution, dependencies);
        case 'mcp':
            return buildMcpResponse(execution, dependencies);
        case 'memory':
            return buildMemoryResponse(execution);
        case 'help':
            return buildHelpResponse();
        case 'usage':
            return commandRoute.response;
        default:
            return undefined;
    }
}

export function resolveDirectCommandSessionId(
    execution: PreparedChatExecution,
    sessionIdOverride?: string,
): string {
    return sessionIdOverride
        ?? execution.agentConfig.session?.id
        ?? `direct:${Date.now()}`;
}

export function emitDirectChatRuntimeEvents(params: {
    execution: PreparedChatExecution;
    response: string;
    onEvent: (event: ConversationEventEnvelope) => void;
    sessionIdOverride?: string;
}): { response: string; sessionId: string } {
    const {
        execution,
        response,
        onEvent,
        sessionIdOverride,
    } = params;
    const sessionId = resolveDirectCommandSessionId(execution, sessionIdOverride);
    const userMessageId = `${sessionId}:user:${Date.now()}`;
    const assistantMessageId = `${sessionId}:assistant:${Date.now()}`;
    const now = Date.now();
    const eventEmitter = createConversationEventEnvelopeEmitter(sessionId);
    const emitEvent = (event: AppEvent): void => {
        onEvent(eventEmitter.emit(event));
    };

    emitEvent(
        execution.agentConfig.session
            ? {
                type: 'session.resumed',
                sessionId,
                timestamp: now,
                source: 'runtime',
                messageCount: execution.agentConfig.session.getMessages().length,
            }
            : {
                type: 'session.started',
                sessionId,
                timestamp: now,
                source: 'runtime',
                cwd: execution.turnInput.resolvedDir,
            },
    );
    emitEvent({
        type: 'message.started',
        sessionId,
        timestamp: now,
        source: 'runtime',
        message: {
            id: userMessageId,
            sessionId,
            role: 'user',
            content: execution.turnInput.rawPrompt,
            createdAt: now,
            ...(execution.turnInput.attachments.length > 0
                ? {
                    attachments: execution.turnInput.attachments.map((attachment) => ({
                        kind: attachment.type,
                        mimeType: attachment.mimeType,
                        data: attachment.data,
                        fileName: attachment.fileName,
                        filePath: attachment.filePath,
                    })),
                }
                : {}),
        },
    });
    emitEvent({
        type: 'message.completed',
        sessionId,
        timestamp: now,
        source: 'runtime',
        message: {
            id: userMessageId,
            sessionId,
            role: 'user',
            content: execution.turnInput.rawPrompt,
            createdAt: now,
            ...(execution.turnInput.attachments.length > 0
                ? {
                    attachments: execution.turnInput.attachments.map((attachment) => ({
                        kind: attachment.type,
                        mimeType: attachment.mimeType,
                        data: attachment.data,
                        fileName: attachment.fileName,
                        filePath: attachment.filePath,
                    })),
                }
                : {}),
        },
    });
    emitEvent({
        type: 'status.changed',
        sessionId,
        timestamp: now,
        source: 'runtime',
        status: 'thinking',
    });
    emitEvent({
        type: 'message.started',
        sessionId,
        timestamp: now + 1,
        source: 'runtime',
        message: {
            id: assistantMessageId,
            sessionId,
            role: 'assistant',
            content: '',
            createdAt: now + 1,
        },
    });
    emitEvent({
        type: 'message.completed',
        sessionId,
        timestamp: now + 2,
        source: 'runtime',
        message: {
            id: assistantMessageId,
            sessionId,
            role: 'assistant',
            content: response,
            createdAt: now + 1,
        },
    });
    emitEvent({
        type: 'status.changed',
        sessionId,
        timestamp: now + 2,
        source: 'runtime',
        status: 'done',
        stopReason: 'completed',
    });

    return {
        response,
        sessionId,
    };
}

function buildStatusResponse(
    execution: PreparedChatExecution,
): string {
    return [
        'Runtime status:',
        `session=${execution.agentConfig.session?.id ?? 'new'}`,
        `cwd=${execution.turnInput.resolvedDir}`,
        `agent=${execution.agentConfig.agentName ?? 'unknown'}`,
        `model=${execution.agentConfig.llmConfig.model}`,
        `runtimeProfile=${execution.turnInput.runtime.runtimeDecision.runtimeProfile}`,
        `interaction=${execution.turnInput.runtime.interaction.kind}`,
        `persistence=${execution.turnInput.shouldPersistSession ? 'enabled' : 'disabled'}`,
    ].join('\n');
}

function buildPermissionsResponse(
    execution: PreparedChatExecution,
    dependencies: ChatTurnIntakeDependencies,
): string {
    const snapshot = createPermissionsSnapshot(
        { cwd: execution.turnInput.resolvedDir },
        resolvePermissionsSnapshotManager(dependencies.configManager),
    );
    return formatPermissionsSnapshot(snapshot);
}

function resolvePermissionsSnapshotManager(
    manager: ChatTurnIntakeDependencies['configManager'] | undefined,
): Pick<ConfigManager, 'load' | 'getLoadMetadata'> {
    if (manager && typeof (manager as { getLoadMetadata?: unknown }).getLoadMetadata === 'function') {
        return manager as Pick<ConfigManager, 'load' | 'getLoadMetadata'>;
    }
    return configManager;
}

async function buildToolsResponse(
    execution: PreparedChatExecution,
    dependencies: DirectChatCommandDependencies,
): Promise<string> {
    const tools = dependencies.listVisibleTools
        ? await dependencies.listVisibleTools(execution)
        : await listVisibleToolsFromAgent(execution);
    if (tools.length === 0) {
        return 'No visible tools for this turn.';
    }

    return [
        'Visible tools for this turn:',
        ...tools.map((tool) => {
            const description = tool.description?.trim()
                ? ` - ${tool.description.trim()}`
                : '';
            return `- ${tool.name} (${tool.permissionMode})${description}`;
        }),
    ].join('\n');
}

async function buildCompactResponse(
    execution: PreparedChatExecution,
    dependencies: DirectChatCommandDependencies,
): Promise<string> {
    const overriddenSummary = dependencies.compactSession
        ? await dependencies.compactSession(execution)
        : undefined;
    if (overriddenSummary !== undefined && overriddenSummary !== null) {
        return overriddenSummary;
    }

    const session = execution.agentConfig.session;
    if (!session) {
        return 'No active session to compact.';
    }

    const messages = session.getMessages().filter((message) => message.role !== 'system');
    if (messages.length < 4) {
        return 'Session compaction unavailable or not needed yet.';
    }

    const summarizer = new SummarizerAgent(execution.agentConfig.llmConfig);
    const summary = await summarizer.summarize(messages);
    if (!summary?.trim()) {
        return 'Session compaction unavailable or not needed yet.';
    }

    session.performCompaction(summary);
    execution.sessionStore?.saveSession({
        session,
        projectRoot: execution.turnInput.resolvedDir,
        cwd: execution.turnInput.resolvedDir,
        model: execution.agentConfig.llmConfig.model,
    });
    return summary;
}

async function listVisibleToolsFromAgent(
    execution: PreparedChatExecution,
): Promise<Array<{ name: string; description?: string; permissionMode: string }>> {
    const agent = new XQoderAgent(execution.agentConfig);

    try {
        return await agent.listVisibleTools();
    } finally {
        await agent.dispose();
    }
}

function buildModelResponse(execution: PreparedChatExecution): string {
    const { llmConfig, agentName } = execution.agentConfig;
    const lines: string[] = [
        'Model configuration:',
        `primary.provider=${llmConfig.provider}`,
        `primary.model=${llmConfig.model}`,
        ...(llmConfig.baseUrl ? [`primary.baseUrl=${llmConfig.baseUrl}`] : []),
        ...(typeof llmConfig.maxTokens === 'number' ? [`primary.maxTokens=${llmConfig.maxTokens}`] : []),
        ...(typeof llmConfig.temperature === 'number' ? [`primary.temperature=${llmConfig.temperature}`] : []),
        `activeAgent=${agentName ?? 'unknown'}`,
    ];
    return lines.join('\n');
}

async function buildDoctorResponse(
    execution: PreparedChatExecution,
    dependencies: DirectChatCommandDependencies,
): Promise<string> {
    const manager = resolveDoctorConfigManager(dependencies.configManager);
    try {
        const report = await createConfigDoctorReport(manager, {
            cwd: execution.turnInput.resolvedDir,
        });
        const header = [
            `Doctor: ${report.ok ? 'ok' : 'issues detected'}`,
            `config=${report.configPath}`,
            ...(report.appliedEnvVars.length > 0
                ? [`envOverrides=${report.appliedEnvVars.join(',')}`]
                : []),
        ];
        const checks = report.checks.map((check) => {
            const marker = check.status === 'ok'
                ? '✓'
                : check.status === 'warn'
                    ? '⚠'
                    : '✗';
            return `${marker} [${check.status}] ${check.name}: ${check.message}`;
        });
        return [...header, '', 'Checks:', ...checks].join('\n');
    } catch (err) {
        return `Doctor command failed: ${err instanceof Error ? err.message : String(err)}`;
    }
}

function buildCostResponse(execution: PreparedChatExecution): string {
    const session = execution.agentConfig.session;
    if (!session) {
        return 'No active session. Start a turn before asking for cost.';
    }
    const usage = session.getUsage();
    if (usage.totalTokens === 0) {
        return `Session ${session.id} has not consumed any tokens yet.`;
    }
    const messages = session.getMessages().filter((message) => message.role !== 'system');
    return [
        `Session: ${session.id}`,
        `Messages: ${messages.length}`,
        `Usage: ${formatSessionUsageSummary(usage)}`,
        `Model: ${execution.agentConfig.llmConfig.model}`,
    ].join('\n');
}

function buildAgentsResponse(
    execution: PreparedChatExecution,
    dependencies: DirectChatCommandDependencies,
): string {
    const manager = resolvePermissionsSnapshotManager(dependencies.configManager);
    const config = manager.load({ cwd: execution.turnInput.resolvedDir });
    const markdownAgents = listMarkdownAgents(execution.turnInput.resolvedDir);
    const builtIns = listBuiltInAgents();

    const names = new Set<string>([
        ...builtIns.map((agent) => agent.name),
        ...markdownAgents.map((agent) => agent.name),
        ...Object.keys(config.agents ?? {}),
    ]);
    if (names.size === 0) {
        return 'No agents defined. Built-in defaults are always available.';
    }

    const defaultAgent = resolveDefaultAgentName(config);
    const lines: string[] = [
        `Agents (default: ${defaultAgent}):`,
    ];
    for (const name of Array.from(names).sort((left, right) => left.localeCompare(right))) {
        const builtIn = getBuiltInAgentDefinition(name);
        const markdown = markdownAgents.find((agent) => agent.name === name);
        const configured = config.agents?.[name];
        const source = markdown
            ? `${markdown.source}@${markdown.filePath}`
            : builtIn
                ? 'built-in'
                : 'config';
        const mode = configured?.mode ?? markdown?.mode ?? builtIn?.mode ?? 'subagent';
        const description = markdown?.description
            ?? (builtIn ? 'Built-in agent' : '');
        lines.push(`- ${name} (${mode}) [${source}]${description ? ` - ${description}` : ''}`);
    }
    return lines.join('\n');
}

function buildMcpResponse(
    execution: PreparedChatExecution,
    dependencies: DirectChatCommandDependencies,
): string {
    const manager = resolvePermissionsSnapshotManager(dependencies.configManager);
    const config = manager.load({ cwd: execution.turnInput.resolvedDir });
    const servers = config.mcp?.servers ?? [];
    if (servers.length === 0) {
        return 'No MCP servers configured. Run `xqoder mcp add <name>` to register one.';
    }

    const lines: string[] = [`MCP servers (${servers.length} configured):`];
    for (const server of servers) {
        const header = `- ${server.name} [${server.transport ?? 'stdio'}] ${server.enabled === false ? '(disabled)' : ''}`.trimEnd();
        lines.push(header);
        if (server.transport === 'http' && server.url) {
            lines.push(`    url=${server.url}`);
        } else if (server.command) {
            const args = Array.isArray(server.args) && server.args.length > 0
                ? ` ${server.args.join(' ')}`
                : '';
            lines.push(`    command=${server.command}${args}`);
        }
        const trust = (server as { trust?: string }).trust;
        if (trust) {
            lines.push(`    trust=${trust}`);
        }
    }
    lines.push('', 'Run `xqoder mcp doctor` to probe connectivity.');
    return lines.join('\n');
}

function buildMemoryResponse(execution: PreparedChatExecution): string {
    const snapshot = createNotepadSnapshot({ cwd: execution.turnInput.resolvedDir });
    if (!snapshot.exists) {
        return [
            `No project notepad at ${snapshot.notepadPath}.`,
            'Run `xqoder notepad write-working "..."` to start one.',
        ].join('\n');
    }

    const lines: string[] = [
        `Notepad: ${snapshot.notepadPath}`,
    ];
    const priority = snapshot.sections.priority.trim();
    if (priority) {
        lines.push('', 'Priority:', priority);
    }

    const latestWorking = snapshot.workingEntries.slice(-5);
    if (latestWorking.length > 0) {
        lines.push('', `Working memory (last ${latestWorking.length} of ${snapshot.workingEntries.length}):`, ...latestWorking);
    }

    const manualEntries = snapshot.manualEntries.slice(0, 5);
    if (manualEntries.length > 0) {
        lines.push('', 'Manual notes:', ...manualEntries);
    }

    return lines.join('\n');
}

function buildHelpResponse(): string {
    return [
        'Available slash commands:',
        '',
        'Runtime info:',
        '  /status         Show runtime, session, model summary',
        '  /permissions    Show permission snapshot',
        '  /tools          List tools visible this turn',
        '  /model          Show current primary model configuration',
        '  /cost           Show session token usage',
        '  /memory         Show project notepad snapshot',
        '',
        'Diagnostics:',
        '  /doctor         Run config/providers/plugins checks',
        '',
        'Discovery:',
        '  /agents         List agents (built-in + markdown + configured)',
        '  /mcp            List configured MCP servers',
        '  /help           Show this help',
        '',
        'Workflow:',
        '  /plan <goal>    Produce a plan (plan-only capability)',
        '  /review <scope> Code review workflow',
        '  /implement <g>  Execute an approved plan',
        '  /skill <n> [g]  Load a skill document then continue',
        '  /compact        Summarize session transcript in place',
    ].join('\n');
}

function resolveDoctorConfigManager(
    manager: ChatTurnIntakeDependencies['configManager'] | undefined,
): Parameters<typeof createConfigDoctorReport>[0] {
    if (
        manager
        && typeof (manager as { getConfigPath?: unknown }).getConfigPath === 'function'
        && typeof (manager as { getLoadMetadata?: unknown }).getLoadMetadata === 'function'
    ) {
        return manager as Parameters<typeof createConfigDoctorReport>[0];
    }
    return configManager;
}
