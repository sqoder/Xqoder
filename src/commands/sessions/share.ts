import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import {
    getXQoderPaths,
    logger,
} from '@xqoder/shared';
import {
    type AgentSession,
    SQLiteSessionStore,
} from '@xqoder/storage-sqlite';
import {
    FileSessionShareStore,
    createSessionExportDocument,
    formatSessionShareDetail,
    formatSessionShareListLine,
    renderSessionMarkdown,
    type SessionShareDetails,
    type SessionShareRecord,
    type SessionShareStore,
} from '../../features/sessions/assets.js';
import {
    resolveSessionForExport,
    type SessionLookupPort,
} from '../../application/sessions/index.js';

interface ShareCommandDependencies {
    sessionStore?: SessionLookupPort;
    shareStore?: SessionShareStore;
    confirmRemove?: (share: SessionShareDetails) => Promise<boolean> | boolean;
    isInteractiveSession?: () => boolean;
}

interface ShareCreateOptions {
    dir: string;
    format: 'json' | 'markdown';
}

interface ShareListOptions {
    dir: string;
    limit?: string;
    all?: boolean;
}

interface ShareRemoveOptions {
    yes?: boolean;
}

export function createShareCommand(
    dependencies: ShareCommandDependencies = {},
): Command {
    const command = new Command('share')
        .description('Manage local session share assets');

    command
        .command('create')
        .description('Generate local share assets for a session')
        .argument('[sessionId]', 'session ID; defaults to the most recent session if omitted')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-f, --format <format>', 'Share format: json | markdown', 'markdown')
        .action((sessionId: string | undefined, options: ShareCreateOptions) => {
            try {
                runCreateShareCommand(sessionId, options, dependencies);
            } catch (error) {
                logger.error(`share create failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    command
        .command('list')
        .description('List local share assets')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-l, --limit <limit>', 'Maximum number of shares to display', '10')
        .option('-a, --all', 'Display shares from all projects')
        .action((options: ShareListOptions) => {
            try {
                runListSharesCommand(options, dependencies);
            } catch (error) {
                logger.error(`share list failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    command
        .command('show')
        .description('View details of a local share')
        .argument('<shareId>', 'share ID')
        .action((shareId: string) => {
            try {
                runShowShareCommand(shareId, dependencies);
            } catch (error) {
                logger.error(`share show failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    command
        .command('remove')
        .alias('unshare')
        .description('Remove a share asset (XQoder unshare)')
        .argument('<shareId>', 'share ID')
        .option('-y, --yes', 'Skip confirmation and delete directly')
        .action(async (shareId: string, options: ShareRemoveOptions) => {
            try {
                await runRemoveShareCommand(shareId, options, dependencies);
            } catch (error) {
                logger.error(`share remove failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    return command;
}

export function runCreateShareCommand(
    sessionId: string | undefined,
    options: ShareCreateOptions,
    dependencies: ShareCommandDependencies = {},
): SessionShareRecord {
    const sessionStore = dependencies.sessionStore ?? createDefaultSessionStore();
    const shareStore = dependencies.shareStore ?? createDefaultShareStore();
    const resolvedDir = path.resolve(options.dir);
    const resolved = resolveSessionForExport(sessionStore, sessionId, resolvedDir);
    const session = resolved.session as AgentSession;
    const payload = options.format === 'json'
        ? JSON.stringify(createSessionExportDocument(resolved.summary, session), null, 2)
        : renderSessionMarkdown(resolved.summary, session);
    const share = shareStore.createShare({
        sessionId: resolved.summary.id,
        projectRoot: resolved.summary.projectRoot,
        title: resolved.summary.title,
        format: options.format,
        content: payload,
        usage: resolved.summary.usage,
    });

    logger.success(`Local share created: ${share.id}`);
    logger.info(`Artifact: ${share.artifactPath} (${share.format})`);
    logger.info(`Share URL: ${buildShareUrl(share.id)}`);
    return share;
}

export function runListSharesCommand(
    options: ShareListOptions,
    dependencies: ShareCommandDependencies = {},
): SessionShareRecord[] {
    const shareStore = dependencies.shareStore ?? createDefaultShareStore();
    const limit = parsePositiveInteger(options.limit, 10);
    const resolvedDir = path.resolve(options.dir);
    const shares = shareStore.listShares(options.all ? undefined : resolvedDir, limit);

    if (shares.length === 0) {
        logger.info(options.all
            ? 'No local shares found.'
            : `No local shares found for project ${resolvedDir}.`);
        return [];
    }

    console.log([
        options.all
            ? `Found ${shares.length} local shares:`
            : `Most recent ${shares.length} local shares for project ${resolvedDir}:`,
        ...shares.map(formatSessionShareListLine),
    ].join('\n'));
    return shares;
}

export function runShowShareCommand(
    shareId: string,
    dependencies: ShareCommandDependencies = {},
): SessionShareDetails {
    const shareStore = dependencies.shareStore ?? createDefaultShareStore();
    const share = shareStore.getShare(shareId);

    if (!share) {
        throw new Error(`Specified share not found: ${shareId}`);
    }

    console.log(formatSessionShareDetail(share));
    return share;
}

export async function runRemoveShareCommand(
    shareId: string,
    options: ShareRemoveOptions = {},
    dependencies: ShareCommandDependencies = {},
): Promise<SessionShareRecord> {
    const shareStore = dependencies.shareStore ?? createDefaultShareStore();
    const share = shareStore.getShare(shareId);

    if (!share) {
        throw new Error(`Specified share not found: ${shareId}`);
    }

    if (!options.yes) {
        const interactive = dependencies.isInteractiveSession?.() ?? isInteractiveSession();
        if (!interactive) {
            throw new Error('Removing a share in a non-interactive environment requires explicit --yes');
        }

        const confirmed = await Promise.resolve(
            dependencies.confirmRemove?.(share) ?? confirmShareRemoval(share),
        );
        if (!confirmed) {
            logger.info(`Deletion cancelled for share: ${shareId}`);
            return share;
        }
    }

    const removed = shareStore.removeShare(shareId);
    if (!removed) {
        throw new Error(`Failed to remove share: ${shareId}`);
    }

    logger.success(`Local share deleted: ${removed.id}`);
    logger.info(`Artifact: ${removed.artifactPath}`);
    return removed;
}

export const shareCommand = createShareCommand();

export { FileSessionShareStore } from '../../features/sessions/assets.js';

function createDefaultSessionStore(): SessionLookupPort {
    return new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
}

function createDefaultShareStore(): SessionShareStore {
    return new FileSessionShareStore(getXQoderPaths().shareDir);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function confirmShareRemoval(share: SessionShareDetails): Promise<boolean> {
    const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        process.stdout.write('\n');
        process.stdout.write(`Will remove local share: ${share.id}\n`);
        process.stdout.write(`Title: ${share.title}\n`);
        process.stdout.write(`Artifact: ${share.artifactPath}\n`);
        process.stdout.write('\n');

        const answer = (await readline.question('Confirm removal? [y/N]: '))
            .trim()
            .toLowerCase();

        return answer === 'y' || answer === 'yes';
    } finally {
        readline.close();
    }
}

function isInteractiveSession(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function buildShareUrl(shareId: string): string {
    const explicit = process.env['XQODER_SHARE_BASE_URL']?.trim();
    const base = explicit && explicit.length > 0
        ? explicit
        : 'http://127.0.0.1:4096';
    return `${base.replace(/\/$/, '')}/share/${encodeURIComponent(shareId)}`;
}
