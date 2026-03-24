import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import {
    logger,
} from '@xqoder/shared';
import {
    createSessionExportDocument,
    renderSessionMarkdown,
    type SessionExportDocument,
} from '../session-assets.js';
import { openDefaultRuntimeSessionKernel } from '../services/runtime-session-kernel.js';
import { resolveSessionForExport, type SessionResolveStore } from '../services/session-resolve.js';

interface ExportCommandDependencies {
    sessionStore?: SessionResolveStore;
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
        .action(async (sessionId: string | undefined, options: ExportCommandOptions) => {
            try {
                await runExportCommand(sessionId, options, dependencies);
            } catch (error) {
                logger.error(`export 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });
}

export async function runExportCommand(
    sessionId: string | undefined,
    options: ExportCommandOptions,
    dependencies: ExportCommandDependencies = {},
): Promise<{
    document: SessionExportDocument;
    payload: string;
    outputPath?: string;
}> {
    const resolvedDir = path.resolve(options.dir);
    const kernelHandle = dependencies.sessionStore
        ? null
        : openDefaultRuntimeSessionKernel({
            projectRoot: resolvedDir,
            model: 'unknown',
        });

    try {
        const sessionStore = dependencies.sessionStore ?? kernelHandle!.kernel;
        const resolved = await resolveSessionForExport(sessionStore, sessionId, resolvedDir);
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
    } finally {
        kernelHandle?.close();
    }
}

export const exportCommand = createExportCommand();
