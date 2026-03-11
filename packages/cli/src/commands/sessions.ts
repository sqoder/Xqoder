import * as path from 'node:path';
import { Command } from 'commander';
import {
    getXQoderPaths,
    logger,
} from '@xqoder/shared';
import {
    SQLiteSessionStore,
    type AgentSessionStore,
    type PersistedSessionSummary,
    type AgentSession,
} from '@xqoder/storage-sqlite';
import { resolveSessionForExport } from '../services/session-resolve.js';

interface SessionsCommandDependencies {
    sessionStore?: Pick<
        AgentSessionStore,
        'findLatestSession' | 'getSession' | 'getSessionSummary' | 'listSessions'
    >;
}

interface SessionsListOptions {
    dir: string;
    limit: string;
    all?: boolean;
    /** OpenCode --max-count / -n */
    maxCount?: string;
    /** OpenCode --format: table | json */
    format?: string;
}

interface SessionsShowOptions {
    dir: string;
    transcriptLimit: string;
    historyLimit: string;
}

export function createSessionsCommand(
    dependencies: SessionsCommandDependencies = {},
): Command {
    const command = new Command('session')
        .alias('sessions')
        .description('查看持久化 session、上下文摘要和历史记录');

    command
        .command('list')
        .description('列出当前项目或全局的持久化 session')
        .option('-d, --dir <dir>', '项目目录', '.')
        .option('-l, --limit <limit>', '最多展示多少条 session', '10')
        .option('-n, --max-count <n>', '最多展示条数（OpenCode 风格）', '10')
        .option('-f, --format <format>', '输出格式: table | json', 'table')
        .option('-a, --all', '显示全部项目的 session')
        .action((options: SessionsListOptions) => {
            try {
                runListSessionsCommand(options, dependencies);
            } catch (err) {
                logger.error(`读取 session 列表失败: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });

    command
        .command('show')
        .description('查看某个 session 的摘要、转录和工具历史')
        .argument('[sessionId]', 'session ID；省略时默认读取当前项目最近一次会话')
        .option('-d, --dir <dir>', '项目目录', '.')
        .option('--transcript-limit <limit>', '展示最近多少条消息', '12')
        .option('--history-limit <limit>', '展示最近多少条命令/文件/工具历史', '8')
        .action((sessionId: string | undefined, options: SessionsShowOptions) => {
            try {
                runShowSessionCommand(sessionId, options, dependencies);
            } catch (err) {
                logger.error(`读取 session 详情失败: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });

    return command;
}

export function runListSessionsCommand(
    options: SessionsListOptions,
    dependencies: SessionsCommandDependencies = {},
): void {
    const sessionStore = dependencies.sessionStore ?? createDefaultSessionStore();
    const limit = parsePositiveInteger(options.maxCount ?? options.limit, 10);
    const resolvedDir = path.resolve(options.dir);
    const sessions = sessionStore.listSessions(options.all ? undefined : resolvedDir, limit);

    if (sessions.length === 0) {
        logger.info(options.all ? '还没有任何持久化 session。' : `项目 ${resolvedDir} 还没有持久化 session。`);
        return;
    }

    const lines = sessions.map((session) => formatSessionListLine(session));
    const format = options.format ?? 'table';
    if (format === 'json') {
        console.log(JSON.stringify(sessions.map(s => ({
            id: s.id,
            title: s.title,
            projectRoot: s.projectRoot,
            updatedAt: s.updatedAt.toISOString(),
            model: s.model,
            messageCount: s.messageCount,
            totalTokens: s.usage.totalTokens,
        })), null, 2));
        return;
    }
    console.log([
        options.all
            ? `已找到 ${sessions.length} 条 session:`
            : `项目 ${resolvedDir} 的最近 ${sessions.length} 条 session:`,
        ...lines,
    ].join('\n'));
}

export function runShowSessionCommand(
    sessionId: string | undefined,
    options: SessionsShowOptions,
    dependencies: SessionsCommandDependencies = {},
): void {
    const sessionStore = dependencies.sessionStore ?? createDefaultSessionStore();
    const resolvedDir = path.resolve(options.dir);
    const transcriptLimit = parsePositiveInteger(options.transcriptLimit, 12);
    const historyLimit = parsePositiveInteger(options.historyLimit, 8);
    const resolved = resolveSessionForExport(sessionStore, sessionId, resolvedDir);
    console.log(formatSessionDetail(resolved.summary, resolved.session, transcriptLimit, historyLimit));
}

export function createSessionCommand(
    dependencies: SessionsCommandDependencies = {},
): Command {
    return createSessionsCommand(dependencies);
}

export const sessionCommand = createSessionCommand();
export const sessionsCommand = sessionCommand;

function createDefaultSessionStore(): AgentSessionStore {
    return new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
}

function parsePositiveInteger(value: string, fallback: number): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function formatSessionListLine(summary: PersistedSessionSummary): string {
    return [
        `- ${summary.id}`,
        `title=${summary.title}`,
        `updated=${formatDateTime(summary.updatedAt)}`,
        `model=${summary.model}`,
        `msgs=${summary.messageCount}`,
        `tokens=${summary.usage.totalTokens}`,
        `commands=${summary.commandCount}`,
        `files=${summary.fileChangeCount}`,
        `compacts=${summary.compactionCount}`,
    ].join('  ');
}

export function formatSessionDetail(
    summary: PersistedSessionSummary,
    session: AgentSession,
    transcriptLimit: number,
    historyLimit: number,
): string {
    const transcript = session.getMessages()
        .slice(-transcriptLimit)
        .map((message) => `- [${message.role}] ${truncateText(singleLine(message.content), 180)}`);
    const commands = session.getCommandHistory()
        .slice(-historyLimit)
        .map((entry) => (
            `- [${formatDateTime(entry.completedAt)}] ${entry.success ? 'OK' : 'FAIL'} ${truncateText(entry.command, 160)}`
        ));
    const fileChanges = session.getFileChanges()
        .slice(-historyLimit)
        .map((entry) => (
            `- [${formatDateTime(entry.timestamp)}] ${formatFileChangeStatus(entry.changeType, entry.success)} ${truncateText(entry.path, 160)} (${entry.bytes} B)`
        ));
    const toolHistory = session.getToolHistory()
        .slice(-historyLimit)
        .map((entry) => (
            `- [${formatDateTime(entry.completedAt)}] ${entry.success ? 'OK' : 'FAIL'} ${entry.name} ${truncateText(JSON.stringify(entry.args), 120)} => ${truncateText(entry.outputPreview, 120)}`
        ));

    return [
        `Session: ${summary.id}`,
        `Title: ${summary.title}`,
        `Project: ${summary.projectRoot}`,
        `Model: ${summary.model}`,
        `Created: ${formatDateTime(summary.createdAt)}`,
        `Updated: ${formatDateTime(summary.updatedAt)}`,
        `Messages: ${summary.messageCount}/${summary.maxMessages}`,
        `Tokens: prompt=${summary.usage.promptTokens}, completion=${summary.usage.completionTokens}, total=${summary.usage.totalTokens}`,
        `Compactions: ${summary.compactionCount}`,
        `Commands: ${summary.commandCount}`,
        `File Changes: ${summary.fileChangeCount}`,
        summary.lastUserMessage ? `Last User Message: ${truncateText(singleLine(summary.lastUserMessage), 180)}` : undefined,
        session.getCompactSummary() ? `Auto Summary:\n${session.getCompactSummary()}` : undefined,
        '',
        'Recent Transcript:',
        ...(transcript.length > 0 ? transcript : ['- 无']),
        '',
        'Command History:',
        ...(commands.length > 0 ? commands : ['- 无']),
        '',
        'File Changes:',
        ...(fileChanges.length > 0 ? fileChanges : ['- 无']),
        '',
        'Tool History:',
        ...(toolHistory.length > 0 ? toolHistory : ['- 无']),
    ].filter((line): line is string => line !== undefined).join('\n');
}

function formatDateTime(value: Date): string {
    return value.toISOString().replace('T', ' ').slice(0, 19);
}

function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function singleLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function formatFileChangeStatus(
    changeType: 'write' | 'patch' | 'restore',
    success: boolean,
): string {
    const label = changeType.toUpperCase();
    return success ? label : `${label}_FAIL`;
}
