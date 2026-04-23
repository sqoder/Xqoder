import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ServeCommandOptions {
    port?: string;
    hostname?: string;
    dir: string;
    mdns?: boolean;
    cors?: string;
}

export interface ServeRuntimeOptions {
    cwd: string;
    port: number;
    hostname: string;
    cors: string[];
    password?: string;
    username: string;
}

export function assertServeDirectoryWritable(
    cwd: string,
    dependencies: {
        existsSync?: (path: string) => boolean;
        accessSync?: (path: string, mode?: number) => void;
        writableMode?: number;
    } = {},
): void {
    const existsSync = dependencies.existsSync ?? fs.existsSync;
    const accessSync = dependencies.accessSync ?? fs.accessSync;
    const writableMode = dependencies.writableMode ?? fs.constants.W_OK;

    if (!existsSync(cwd)) {
        throw new Error(`Project directory does not exist: ${cwd}`);
    }

    try {
        accessSync(cwd, writableMode);
    } catch {
        throw new Error(`Project directory is not writable, session will not persist: ${cwd}`);
    }
}

export function resolveServeRuntimeOptions(
    options: ServeCommandOptions,
    serverConfig: { port?: number; hostname?: string; cors?: string[] } = {},
    env: NodeJS.ProcessEnv = process.env,
): ServeRuntimeOptions {
    const cwd = path.resolve(options.dir);
    const parsedPort = options.port ? Number.parseInt(options.port, 10) : Number.NaN;

    return {
        cwd,
        port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : (serverConfig.port ?? 4096),
        hostname: options.hostname?.trim() || serverConfig.hostname || '127.0.0.1',
        cors: options.cors
            ? options.cors.split(',').map((segment) => segment.trim()).filter(Boolean)
            : (serverConfig.cors ?? []),
        password: env.XQODER_SERVER_PASSWORD,
        username: env.XQODER_SERVER_USERNAME ?? 'xqoder',
    };
}
