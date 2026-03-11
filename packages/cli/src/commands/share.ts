import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import {
    getXQoderPaths,
    logger,
} from '@xqoder/shared';
import {
    SQLiteSessionStore,
    type AgentSessionStore,
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
} from '../session-assets.js';
import { resolveSessionForExport } from '../services/session-resolve.js';

interface ShareCommandDependencies {
    sessionStore?: Pick<AgentSessionStore, 'findLatestSession' | 'getSession' | 'getSessionSummary'>;
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
        .description('管理本地 session share 资产');

    command
        .command('create')
        .description('为某个 session 生成本地 share 资产')
        .argument('[sessionId]', 'session ID；省略时使用当前项目最近一次会话')
        .option('-d, --dir <dir>', '项目目录', '.')
        .option('-f, --format <format>', 'share 格式: json | markdown', 'markdown')
        .action((sessionId: string | undefined, options: ShareCreateOptions) => {
            try {
                runCreateShareCommand(sessionId, options, dependencies);
            } catch (error) {
                logger.error(`share create 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    command
        .command('list')
        .description('列出本地 share 资产')
        .option('-d, --dir <dir>', '项目目录', '.')
        .option('-l, --limit <limit>', '最多展示多少条 share', '10')
        .option('-a, --all', '显示全部项目的 share')
        .action((options: ShareListOptions) => {
            try {
                runListSharesCommand(options, dependencies);
            } catch (error) {
                logger.error(`share list 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    command
        .command('show')
        .description('查看某个本地 share 的详情')
        .argument('<shareId>', 'share ID')
        .action((shareId: string) => {
            try {
                runShowShareCommand(shareId, dependencies);
            } catch (error) {
                logger.error(`share show 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    command
        .command('remove')
        .alias('unshare')
        .description('删除某个 share 资产（OpenCode unshare）')
        .argument('<shareId>', 'share ID')
        .option('-y, --yes', '跳过确认，直接删除')
        .action(async (shareId: string, options: ShareRemoveOptions) => {
            try {
                await runRemoveShareCommand(shareId, options, dependencies);
            } catch (error) {
                logger.error(`share remove 失败: ${error instanceof Error ? error.message : String(error)}`);
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
    const payload = options.format === 'json'
        ? JSON.stringify(createSessionExportDocument(resolved.summary, resolved.session), null, 2)
        : renderSessionMarkdown(resolved.summary, resolved.session);
    const share = shareStore.createShare({
        sessionId: resolved.summary.id,
        projectRoot: resolved.summary.projectRoot,
        title: resolved.summary.title,
        format: options.format,
        content: payload,
    });

    logger.success(`已创建本地 share: ${share.id}`);
    logger.info(`Artifact: ${share.artifactPath} (${share.format})`);
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
            ? '还没有任何本地 share。'
            : `项目 ${resolvedDir} 还没有本地 share。`);
        return [];
    }

    console.log([
        options.all
            ? `已找到 ${shares.length} 个本地 share:`
            : `项目 ${resolvedDir} 的最近 ${shares.length} 个本地 share:`,
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
        throw new Error(`未找到指定 share: ${shareId}`);
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
        throw new Error(`未找到指定 share: ${shareId}`);
    }

    if (!options.yes) {
        const interactive = dependencies.isInteractiveSession?.() ?? isInteractiveSession();
        if (!interactive) {
            throw new Error('非交互环境删除 share 需要显式传入 --yes');
        }

        const confirmed = await Promise.resolve(
            dependencies.confirmRemove?.(share) ?? confirmShareRemoval(share),
        );
        if (!confirmed) {
            logger.info(`已取消删除 share: ${shareId}`);
            return share;
        }
    }

    const removed = shareStore.removeShare(shareId);
    if (!removed) {
        throw new Error(`删除 share 失败: ${shareId}`);
    }

    logger.success(`已删除本地 share: ${removed.id}`);
    logger.info(`Artifact: ${removed.artifactPath}`);
    return removed;
}

export const shareCommand = createShareCommand();

export { FileSessionShareStore } from '../session-assets.js';

function createDefaultSessionStore(): AgentSessionStore {
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
        process.stdout.write(`将删除本地 share: ${share.id}\n`);
        process.stdout.write(`Title: ${share.title}\n`);
        process.stdout.write(`Artifact: ${share.artifactPath}\n`);
        process.stdout.write('\n');

        const answer = (await readline.question('确认删除? [y/N]: '))
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
