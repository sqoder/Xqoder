import * as fs from 'node:fs';
import * as path from 'node:path';
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
    createSessionExportDocument,
    renderSessionMarkdown,
    type SessionExportDocument,
} from '../../features/sessions/assets.js';
import {
    resolveSessionForExport,
    type SessionLookupPort,
} from '../../application/sessions/index.js';

interface ExportCommandDependencies {
    sessionStore?: SessionLookupPort;
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
        .description('Export a session as JSON or Markdown asset')
        .argument('[sessionId]', 'session ID; defaults to the most recent session of the current project if omitted')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-o, --out <file>', 'Output file path')
        .option('-f, --format <format>', 'Export format: json | markdown', 'json')
        .action((sessionId: string | undefined, options: ExportCommandOptions) => {
            try {
                runExportCommand(sessionId, options, dependencies);
            } catch (error) {
                logger.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
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
    const session = resolved.session as AgentSession;
    const document = createSessionExportDocument(resolved.summary, session);
    const payload = options.format === 'markdown'
        ? renderSessionMarkdown(resolved.summary, session)
        : JSON.stringify(document, null, 2);

    if (options.out) {
        const outputPath = path.resolve(options.out);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, payload, 'utf-8');
        logger.success(`Session exported to ${outputPath}`);
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

function createDefaultSessionStore(): SessionLookupPort {
    return new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
}
