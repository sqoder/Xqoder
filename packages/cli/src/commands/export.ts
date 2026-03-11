import * as fs from 'node:fs';
import * as path from 'node:path';
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
    createSessionExportDocument,
    renderSessionMarkdown,
    type SessionExportDocument,
} from '../session-assets.js';
import { resolveSessionForExport } from '../services/session-resolve.js';

interface ExportCommandDependencies {
    sessionStore?: Pick<AgentSessionStore, 'findLatestSession' | 'getSession' | 'getSessionSummary'>;
}

interface ExportCommandOptions {
    dir: string;
    out?: string;
    format: 'json' | 'markdown';
}

export function createExportCommand(
    dependencies: ExportCommandDependencies = {},
): Command {
    return new Command('export')
        .description('导出某个 session 的 JSON 或 Markdown 资产')
        .argument('[sessionId]', 'session ID；省略时导出当前项目最近一次会话')
        .option('-d, --dir <dir>', '项目目录', '.')
        .option('-o, --out <file>', '输出文件路径')
        .option('-f, --format <format>', '导出格式: json | markdown', 'json')
        .action((sessionId: string | undefined, options: ExportCommandOptions) => {
            try {
                runExportCommand(sessionId, options, dependencies);
            } catch (error) {
                logger.error(`export 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });
}

export function runExportCommand(
    sessionId: string | undefined,
    options: ExportCommandOptions,
    dependencies: ExportCommandDependencies = {},
): {
    document: SessionExportDocument;
    payload: string;
    outputPath?: string;
} {
    const sessionStore = dependencies.sessionStore ?? createDefaultSessionStore();
    const resolvedDir = path.resolve(options.dir);
    const resolved = resolveSessionForExport(sessionStore, sessionId, resolvedDir);
    const document = createSessionExportDocument(resolved.summary, resolved.session);
    const payload = options.format === 'markdown'
        ? renderSessionMarkdown(resolved.summary, resolved.session)
        : JSON.stringify(document, null, 2);

    if (options.out) {
        const outputPath = path.resolve(options.out);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, payload, 'utf-8');
        logger.success(`已导出 session 到 ${outputPath}`);
        return {
            document,
            payload,
            outputPath,
        };
    }

    console.log(payload);
    return {
        document,
        payload,
    };
}

export const exportCommand = createExportCommand();

function createDefaultSessionStore(): AgentSessionStore {
    return new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
}
