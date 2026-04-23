import * as path from 'node:path';
import { Command } from 'commander';
import {
    getXQoderPaths,
    logger,
} from '@xqoder/shared';
import {
    SQLiteSessionStore,
} from '@xqoder/storage-sqlite';
import {
    formatSessionDetail,
    formatSessionListLine,
    resolveSessionForExport,
    type SessionListPort,
} from '../../application/sessions/index.js';

interface SessionsCommandDependencies {
    sessionStore?: SessionListPort;
}

interface SessionsListOptions {
    dir: string;
    limit: string;
    all?: boolean;
    /** XQoder --max-count / -n */
    maxCount?: string;
    /** XQoder --format: table | json */
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
        .description('View persisted sessions, context summaries, and history');

    command
        .command('list')
        .description('List persisted sessions for the current project or globally')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-l, --limit <limit>', 'Maximum number of sessions to display', '10')
        .option('-n, --max-count <n>', 'Maximum count (XQoder style)', '10')
        .option('-f, --format <format>', 'Output format: table | json', 'table')
        .option('-a, --all', 'Display sessions from all projects')
        .action((options: SessionsListOptions) => {
            try {
                runListSessionsCommand(options, dependencies);
            } catch (err) {
                logger.error(`Failed to read session list: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });

    command
        .command('show')
        .description('View summary, transcript, and tool history of a specific session')
        .argument('[sessionId]', 'session ID; defaults to the most recent session of the current project if omitted')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('--transcript-limit <limit>', 'Number of recent messages to display', '12')
        .option('--history-limit <limit>', 'Number of recent command/file/tool history entries to display', '8')
        .action((sessionId: string | undefined, options: SessionsShowOptions) => {
            try {
                runShowSessionCommand(sessionId, options, dependencies);
            } catch (err) {
                logger.error(`Failed to read session details: ${err instanceof Error ? err.message : String(err)}`);
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
        logger.info(options.all ? 'No persisted sessions found.' : `No persisted sessions found for project ${resolvedDir}.`);
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
            usage: s.usage,
            totalTokens: s.usage.totalTokens,
        })), null, 2));
        return;
    }
    console.log([
        options.all
            ? `Found ${sessions.length} sessions:`
            : `Most recent ${sessions.length} sessions for project ${resolvedDir}:`,
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

function createDefaultSessionStore(): SessionListPort {
    return new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
}

function parsePositiveInteger(value: string, fallback: number): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
