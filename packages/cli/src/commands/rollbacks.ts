import * as path from 'node:path';
import * as fs from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import {
    getXQoderPaths,
    logger,
} from '@xqoder/shared';
import {
    FileRollbackStore,
    type RollbackPoint,
    type RollbackPointDetails,
    type RollbackStore,
} from '@xqoder/agent';

interface RollbacksCommandDependencies {
    rollbackStore?: Pick<
        RollbackStore,
        'getPointDetails' | 'listPoints' | 'restorePoint'
    >;
    confirmRestore?: (point: RollbackPointDetails) => Promise<boolean> | boolean;
    isInteractiveSession?: () => boolean;
}

interface RollbacksListOptions {
    dir: string;
    limit: string;
    all?: boolean;
}

interface RollbacksRestoreOptions {
    yes?: boolean;
}

export function createRollbacksCommand(
    dependencies: RollbacksCommandDependencies = {},
): Command {
    const command = new Command('rollbacks')
        .description('查看和恢复本地 rollback point');

    command
        .command('list')
        .description('列出当前项目或全局的 rollback point')
        .option('-d, --dir <dir>', '项目目录', '.')
        .option('-l, --limit <limit>', '最多展示多少条 rollback point', '10')
        .option('-a, --all', '显示全部项目的 rollback point')
        .action((options: RollbacksListOptions) => {
            try {
                runListRollbacksCommand(options, dependencies);
            } catch (err) {
                logger.error(`读取 rollback 列表失败: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });

    command
        .command('show')
        .description('查看某个 rollback point 的详情')
        .argument('<rollbackId>', 'rollback point ID')
        .action((rollbackId: string) => {
            try {
                runShowRollbackCommand(rollbackId, dependencies);
            } catch (err) {
                logger.error(`读取 rollback 详情失败: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });

    command
        .command('restore')
        .description('按 rollback point ID 恢复文件状态')
        .argument('<rollbackId>', 'rollback point ID')
        .option('-y, --yes', '跳过确认，直接恢复')
        .action(async (rollbackId: string, options: RollbacksRestoreOptions) => {
            try {
                await runRestoreRollbackCommand(rollbackId, options, dependencies);
            } catch (err) {
                logger.error(`恢复 rollback 失败: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });

    return command;
}

export function runListRollbacksCommand(
    options: RollbacksListOptions,
    dependencies: RollbacksCommandDependencies = {},
): void {
    const rollbackStore = dependencies.rollbackStore ?? createDefaultRollbackStore();
    const limit = parsePositiveInteger(options.limit, 10);
    const resolvedDir = path.resolve(options.dir);
    const points = rollbackStore.listPoints(options.all ? undefined : resolvedDir, limit);

    if (points.length === 0) {
        logger.info(options.all
            ? '还没有任何 rollback point。'
            : `项目 ${resolvedDir} 还没有 rollback point。`);
        return;
    }

    console.log([
        options.all
            ? `已找到 ${points.length} 个 rollback point:`
            : `项目 ${resolvedDir} 的最近 ${points.length} 个 rollback point:`,
        ...points.map(formatRollbackListLine),
    ].join('\n'));
}

export function runShowRollbackCommand(
    rollbackId: string,
    dependencies: RollbacksCommandDependencies = {},
): void {
    const rollbackStore = dependencies.rollbackStore ?? createDefaultRollbackStore();
    const point = rollbackStore.getPointDetails(rollbackId);

    if (!point) {
        throw new Error(`未找到指定 rollback point: ${rollbackId}`);
    }

    console.log(formatRollbackDetail(point));
}

export async function runRestoreRollbackCommand(
    rollbackId: string,
    options: RollbacksRestoreOptions = {},
    dependencies: RollbacksCommandDependencies = {},
): Promise<void> {
    const rollbackStore = dependencies.rollbackStore ?? createDefaultRollbackStore();
    const pointDetails = rollbackStore.getPointDetails(rollbackId);

    if (!pointDetails) {
        throw new Error(`未找到指定 rollback point: ${rollbackId}`);
    }

    if (!options.yes) {
        const interactive = dependencies.isInteractiveSession?.() ?? isInteractiveSession();
        if (!interactive) {
            throw new Error('非交互环境恢复 rollback 需要显式传入 --yes');
        }

        const confirmed = await Promise.resolve(
            dependencies.confirmRestore?.(pointDetails) ?? confirmRollbackRestore(pointDetails),
        );
        if (!confirmed) {
            logger.info(`已取消恢复 rollback point: ${rollbackId}`);
            return;
        }
    }

    const point = rollbackStore.restorePoint(rollbackId);

    logger.success(`已恢复回滚点: ${point.id}`);
    logger.info(`Project: ${point.projectRoot} | Tool: ${point.toolName} | Files: ${point.filePaths.length}`);
}

export const rollbacksCommand = createRollbacksCommand();

/**
 * TUI / UI 专用：无交互确认地恢复 rollback point，并返回恢复结果。
 * 这能保证所有 rollback 入口逻辑统一走 rollbacks.ts。
 */
export function restoreRollbackPointUi(
    rollbackId: string,
    dependencies: RollbacksCommandDependencies = {},
): RollbackPoint {
    const rollbackStore = dependencies.rollbackStore ?? createDefaultRollbackStore();
    return rollbackStore.restorePoint(rollbackId);
}

/**
 * TUI / UI 专用：保留改动（丢弃 rollback 快照文件）。
 * 由于当前 RollbackStore 接口没有 delete 方法，这里直接按 FileRollbackStore 的落盘规则删 JSON。
 */
export function keepRollbackPointUi(
    rollbackId: string,
): void {
    const filePath = path.join(getXQoderPaths().rollbackDir, `${rollbackId}.json`);
    try {
        fs.unlinkSync(filePath);
    } catch {
        // ignore: 快照可能已不存在或已被其它逻辑清理
    }
}

function createDefaultRollbackStore(): RollbackStore {
    return new FileRollbackStore(getXQoderPaths().rollbackDir);
}

function parsePositiveInteger(value: string, fallback: number): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatRollbackListLine(point: RollbackPoint): string {
    return [
        `- ${point.id}`,
        `created=${formatDateTime(point.createdAt)}`,
        `tool=${point.toolName}`,
        `files=${point.filePaths.length}`,
        ...(point.sessionId ? [`session=${point.sessionId}`] : []),
    ].join('  ');
}

function formatRollbackDetail(point: RollbackPointDetails): string {
    const fileLines = point.files.map((file: RollbackPointDetails['files'][number]) => {
        const action = file.existedBefore ? 'RESTORE_FILE' : 'DELETE_ON_RESTORE';
        const bytes = Buffer.byteLength(file.content ?? '', 'utf-8');
        return `- ${action} ${file.path}${file.existedBefore ? ` (${bytes} B)` : ''}`;
    });

    return [
        `Rollback: ${point.id}`,
        `Project: ${point.projectRoot}`,
        `Tool: ${point.toolName}`,
        `Created: ${formatDateTime(point.createdAt)}`,
        point.sessionId ? `Session: ${point.sessionId}` : undefined,
        `Files: ${point.filePaths.length}`,
        '',
        'Tracked Files:',
        ...(fileLines.length > 0 ? fileLines : ['- 无']),
    ].filter((line): line is string => line !== undefined).join('\n');
}

function formatDateTime(value: Date): string {
    return value.toISOString().replace('T', ' ').slice(0, 19);
}

async function confirmRollbackRestore(point: RollbackPointDetails): Promise<boolean> {
    const previewLines = point.files
        .slice(0, 8)
        .map((file) => (
            `- ${file.existedBefore ? 'RESTORE_FILE' : 'DELETE_ON_RESTORE'} ${file.path}`
        ));
    const truncated = point.files.length > previewLines.length
        ? [`- ... 还有 ${point.files.length - previewLines.length} 个文件`]
        : [];
    const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        process.stdout.write('\n');
        process.stdout.write(`将恢复 rollback point: ${point.id}\n`);
        process.stdout.write(`Project: ${point.projectRoot}\n`);
        process.stdout.write(`Tool: ${point.toolName}\n`);
        process.stdout.write(`Files: ${point.filePaths.length}\n`);
        process.stdout.write([
            ...previewLines,
            ...truncated,
        ].join('\n'));
        process.stdout.write('\n');

        const answer = (await readline.question('确认恢复? [y/N]: '))
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
