import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import {
    logger,
} from '@xqoder/shared';

const SHARE_URL_PATTERN = /^https?:\/\//i;
import {
    type PersistedSessionSummary,
    type SaveSessionInput,
} from '@xqoder/agent';
import {
    createImportedSession,
    createImportedSessionRecord,
    parseSessionExportDocument,
} from '../session-assets.js';
import {
    applySessionReplayBundle,
    isSessionReplayBundleDocument,
    parseSessionReplayBundleDocument,
} from '../session-bundle.js';
import { resolveSessionExistsById, type SessionResolveStore, toPersistedSessionSummary } from '../services/session-resolve.js';
import {
    openDefaultRuntimeSessionKernel,
    type RuntimeSessionKernelFacade,
} from '../services/runtime-session-kernel.js';

interface ImportCommandDependencies {
    sessionStore?: SessionResolveStore & {
        saveSessionSnapshot: (input: SaveSessionInput) => PersistedSessionSummary;
    };
    openSessionKernel?: (defaults: {
        projectRoot: string;
        model: string;
    }) => {
        kernel: RuntimeSessionKernelFacade;
        close(): void;
    };
}

interface ImportCommandOptions {
    dir?: string;
    cwd?: string;
    sessionId?: string;
    model?: string;
    title?: string;
}

export function createImportCommand(
    dependencies: ImportCommandDependencies = {},
): Command {
    return new Command('import')
        .description('导入一个通过 xqoder export/share 生成的 session JSON 或 replay bundle')
        .argument('<file>', '导入文件路径')
        .option('-d, --dir <dir>', '导入后的项目根目录')
        .option('--cwd <cwd>', '导入后的工作目录')
        .option('-s, --session-id <id>', '覆盖导入后的 session ID')
        .option('-m, --model <model>', '覆盖导入后的模型')
        .option('--title <title>', '覆盖导入后的标题')
        .action(async (file: string, options: ImportCommandOptions) => {
            try {
                await runImportCommand(file, options, dependencies);
            } catch (error) {
                logger.error(`import 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });
}

export async function runImportCommand(
    filePath: string,
    options: ImportCommandOptions,
    dependencies: ImportCommandDependencies = {},
): Promise<PersistedSessionSummary> {
    const raw = await loadImportSource(filePath);
    const bundle = isSessionReplayBundleDocument(raw)
        ? parseSessionReplayBundleDocument(raw)
        : undefined;
    const document = bundle ?? parseSessionExportDocument(raw);
    const resolvedProjectRoot = path.resolve(options.dir ?? document.summary.projectRoot);
    const resolvedCwd = path.resolve(options.cwd ?? options.dir ?? document.summary.cwd ?? resolvedProjectRoot);
    const model = options.model?.trim() || document.summary.model;
    const title = options.title?.trim() || document.summary.title;

    if (bundle) {
        const applied = applySessionReplayBundle(bundle, resolvedProjectRoot);
        logger.info(`已应用 replay bundle 文件变更: write=${applied.appliedFiles} delete=${applied.deletedFiles}`);
    }

    const summary = dependencies.sessionStore
        ? await importIntoLegacySessionStore(dependencies.sessionStore, document, {
            projectRoot: resolvedProjectRoot,
            cwd: resolvedCwd,
            model,
            title,
            preferredSessionId: options.sessionId,
        })
        : await importViaRuntimeKernelHandle(
            (dependencies.openSessionKernel ?? openDefaultRuntimeSessionKernel)({
                projectRoot: resolvedProjectRoot,
                model,
            }),
            document,
            {
                projectRoot: resolvedProjectRoot,
                cwd: resolvedCwd,
                model,
                title,
                preferredSessionId: options.sessionId,
            },
        );

    logger.success(`已导入 session: ${summary.id}`);
    return summary;
}

export const importCommand = createImportCommand();

async function loadImportSource(source: string): Promise<unknown> {
    if (SHARE_URL_PATTERN.test(source.trim())) {
        const res = await fetch(source.trim(), {
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
            throw new Error(`导入 URL 失败: ${res.status} ${res.statusText}`);
        }
        return res.json() as Promise<unknown>;
    }
    return JSON.parse(fs.readFileSync(path.resolve(source), 'utf-8')) as unknown;
}

async function resolveImportedSessionId(
    sessionStore: SessionResolveStore,
    document: ReturnType<typeof parseSessionExportDocument>,
    preferredId?: string,
): Promise<string> {
    const normalizedPreferredId = preferredId?.trim();
    if (normalizedPreferredId) {
        return normalizedPreferredId;
    }

    const exists = await resolveSessionExistsById(sessionStore, document.snapshot.id);
    if (exists) {
        return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    return document.snapshot.id;
}

type RuntimeSessionReadKernel = Pick<RuntimeSessionKernelFacade, 'loadSessionSnapshot'>;

type RuntimeSessionWriteKernel = Pick<RuntimeSessionKernelFacade, 'saveSessionSnapshot'>
    & Partial<Pick<RuntimeSessionKernelFacade, 'commitSessionSnapshot'>>;

async function resolveImportedSessionIdFromKernel(
    kernel: RuntimeSessionReadKernel,
    document: ReturnType<typeof parseSessionExportDocument>,
    preferredId?: string,
): Promise<string> {
    const normalizedPreferredId = preferredId?.trim();
    if (normalizedPreferredId) {
        return normalizedPreferredId;
    }

    const existing = await kernel.loadSessionSnapshot(document.snapshot.id);
    if (!existing) {
        return document.snapshot.id;
    }

    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function importIntoLegacySessionStore(
    sessionStore: SessionResolveStore & {
        saveSessionSnapshot: (input: SaveSessionInput) => PersistedSessionSummary;
    },
    document: ReturnType<typeof parseSessionExportDocument>,
    options: {
        projectRoot: string;
        cwd: string;
        model: string;
        title: string;
        preferredSessionId?: string;
    },
): Promise<PersistedSessionSummary> {
    const targetSessionId = await resolveImportedSessionId(
        sessionStore,
        document,
        options.preferredSessionId,
    );
    const session = createImportedSession(document, targetSessionId);
    return sessionStore.saveSessionSnapshot({
        session,
        projectRoot: options.projectRoot,
        cwd: options.cwd,
        model: options.model,
        title: options.title,
    });
}

async function importViaRuntimeKernelHandle(
    kernelHandle: ReturnType<NonNullable<ImportCommandDependencies['openSessionKernel']>>,
    document: ReturnType<typeof parseSessionExportDocument>,
    options: {
        projectRoot: string;
        cwd: string;
        model: string;
        title: string;
        preferredSessionId?: string;
    },
): Promise<PersistedSessionSummary> {
    try {
        const targetSessionId = await resolveImportedSessionIdFromKernel(
            kernelHandle.kernel,
            document,
            options.preferredSessionId,
        );
        const record = createImportedSessionRecord(document, targetSessionId, {
            projectRoot: options.projectRoot,
            cwd: options.cwd,
            model: options.model,
            title: options.title,
        });
        const committed = typeof (kernelHandle.kernel as RuntimeSessionWriteKernel).commitSessionSnapshot === 'function'
            ? await (kernelHandle.kernel as RuntimeSessionWriteKernel).commitSessionSnapshot!(record)
            : await kernelHandle.kernel.saveSessionSnapshot(record);
        return toPersistedSessionSummary(committed);
    } finally {
        kernelHandle.close();
    }
}
