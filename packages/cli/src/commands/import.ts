import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import {
    getXQoderPaths,
    logger,
} from '@xqoder/shared';

const SHARE_URL_PATTERN = /^https?:\/\//i;
import {
    SQLiteSessionStore,
    type AgentSessionStore,
    type PersistedSessionSummary,
} from '@xqoder/storage-sqlite';
import {
    createImportedSession,
    parseSessionExportDocument,
} from '../session-assets.js';

interface ImportCommandDependencies {
    sessionStore?: Pick<AgentSessionStore, 'getSession' | 'saveSession'>;
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
        .description('导入一个通过 xqoder export 生成的 session JSON')
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
    const sessionStore = dependencies.sessionStore ?? createDefaultSessionStore();
    const raw = await loadImportSource(filePath);
    const document = parseSessionExportDocument(raw);
    const resolvedProjectRoot = path.resolve(options.dir ?? document.summary.projectRoot);
    const resolvedCwd = path.resolve(options.cwd ?? options.dir ?? document.summary.cwd ?? resolvedProjectRoot);
    const targetSessionId = resolveImportedSessionId(
        sessionStore,
        document,
        options.sessionId,
    );
    const session = createImportedSession(document, targetSessionId);
    const summary = sessionStore.saveSession({
        session,
        projectRoot: resolvedProjectRoot,
        cwd: resolvedCwd,
        model: options.model?.trim() || document.summary.model,
        title: options.title?.trim() || document.summary.title,
    });

    logger.success(`已导入 session: ${summary.id}`);
    return summary;
}

export const importCommand = createImportCommand();

function createDefaultSessionStore(): AgentSessionStore {
    return new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
}

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

function resolveImportedSessionId(
    sessionStore: Pick<AgentSessionStore, 'getSession'>,
    document: ReturnType<typeof parseSessionExportDocument>,
    preferredId?: string,
): string {
    const normalizedPreferredId = preferredId?.trim();
    if (normalizedPreferredId) {
        return normalizedPreferredId;
    }

    const existing = sessionStore.getSession(document.snapshot.id);
    if (!existing) {
        return document.snapshot.id;
    }

    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
