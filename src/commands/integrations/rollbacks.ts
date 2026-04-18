import * as path from 'node:path';
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
        .description('View and restore local rollback points');

    command
        .command('list')
        .description('List rollback points for the current project or globally')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-l, --limit <limit>', 'Maximum number of rollback points to show', '10')
        .option('-a, --all', 'Show rollback points for all projects')
        .action((options: RollbacksListOptions) => {
            try {
                runListRollbacksCommand(options, dependencies);
            } catch (err) {
                logger.error(`Failed to read rollback list: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });

    command
        .command('show')
        .description('View details of a specific rollback point')
        .argument('<rollbackId>', 'rollback point ID')
        .action((rollbackId: string) => {
            try {
                runShowRollbackCommand(rollbackId, dependencies);
            } catch (err) {
                logger.error(`Failed to read rollback details: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });

    command
        .command('restore')
        .description('Restore file state using a rollback point ID')
        .argument('<rollbackId>', 'rollback point ID')
        .option('-y, --yes', 'Skip confirmation and restore directly')
        .action(async (rollbackId: string, options: RollbacksRestoreOptions) => {
            try {
                await runRestoreRollbackCommand(rollbackId, options, dependencies);
            } catch (err) {
                logger.error(`Failed to restore rollback: ${err instanceof Error ? err.message : String(err)}`);
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
            ? 'No rollback points found yet.'
            : `Project ${resolvedDir} has no rollback points yet.`);
        return;
    }

    console.log([
        options.all
            ? `Found ${points.length} rollback point(s):`
            : `Recent ${points.length} rollback point(s) for project ${resolvedDir}:`,
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
        throw new Error(`Rollback point not found: ${rollbackId}`);
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
        throw new Error(`Rollback point not found: ${rollbackId}`);
    }

    if (!options.yes) {
        const interactive = dependencies.isInteractiveSession?.() ?? isInteractiveSession();
        if (!interactive) {
            throw new Error('--yes is required to restore rollback in non-interactive environments');
        }

        const confirmed = await Promise.resolve(
            dependencies.confirmRestore?.(pointDetails) ?? confirmRollbackRestore(pointDetails),
        );
        if (!confirmed) {
            logger.info(`Rollback restore cancelled for: ${rollbackId}`);
            return;
        }
    }

    const point = rollbackStore.restorePoint(rollbackId);

    logger.success(`Restored rollback point: ${point.id}`);
    logger.info(`Project: ${point.projectRoot} | Tool: ${point.toolName} | Files: ${point.filePaths.length}`);
}

export const rollbacksCommand = createRollbacksCommand();

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
        ...(fileLines.length > 0 ? fileLines : ['- None']),
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
        ? [`- ... and ${point.files.length - previewLines.length} more files`]
        : [];
    const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        process.stdout.write('\n');
        process.stdout.write(`Will restore rollback point: ${point.id}\n`);
        process.stdout.write(`Project: ${point.projectRoot}\n`);
        process.stdout.write(`Tool: ${point.toolName}\n`);
        process.stdout.write(`Files: ${point.filePaths.length}\n`);
        process.stdout.write([
            ...previewLines,
            ...truncated,
        ].join('\n'));
        process.stdout.write('\n');

        const answer = (await readline.question('Confirm restore? [y/N]: '))
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
