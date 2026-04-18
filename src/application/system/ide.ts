import * as path from 'node:path';

const DEFAULT_IDE_HOST = '127.0.0.1';
const DEFAULT_IDE_PORT = 4096;

export interface IdeCommandOutputOptions {
    cwd?: string;
    json?: boolean;
    host?: string;
    port?: number;
}

export interface IdeCommandDependencies {
    writeOutput?: (output: string) => void;
}

export type DetectedIdeSurface =
    | 'cursor'
    | 'jetbrains'
    | 'vscode'
    | 'zed';

export interface IdeSnapshot {
    cwd: string;
    detectedSurfaces: DetectedIdeSurface[];
    bridgeStatus: 'not-configured';
    host: string;
    port: number;
    serverUrl: string;
    serveCommand: string;
    attachCommand: string;
    acpCommand: string;
    notes: string[];
}

export function createIdeSnapshot(
    options: IdeCommandOutputOptions = {},
    env: NodeJS.ProcessEnv = process.env,
): IdeSnapshot {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const host = options.host?.trim() || DEFAULT_IDE_HOST;
    const port = Number.isFinite(options.port) && (options.port ?? 0) > 0
        ? Number(options.port)
        : DEFAULT_IDE_PORT;
    const serverUrl = `http://${host}:${port}`;

    return {
        cwd,
        detectedSurfaces: detectIdeSurfaces(env),
        bridgeStatus: 'not-configured',
        host,
        port,
        serverUrl,
        serveCommand: `xqoder serve --dir ${quoteShellArg(cwd)} --hostname ${host} --port ${port}`,
        attachCommand: `xqoder attach ${serverUrl} --dir ${quoteShellArg(cwd)}`,
        acpCommand: `xqoder acp --cwd ${quoteShellArg(cwd)}`,
        notes: [
            'Start `xqoder serve` inside the project the IDE should control.',
            'Attach a local TUI or IDE bridge to the same server URL.',
            'Use `xqoder acp` when the client expects a stdio ACP endpoint instead of HTTP attach.',
        ],
    };
}

export function runShowIdeCommand(
    options: IdeCommandOutputOptions = {},
    dependencies: IdeCommandDependencies = {},
    env: NodeJS.ProcessEnv = process.env,
): IdeSnapshot {
    const snapshot = createIdeSnapshot(options, env);

    if (options.json) {
        writeOutput(JSON.stringify(snapshot, null, 2), dependencies);
        return snapshot;
    }

    writeOutput([
        `cwd=${snapshot.cwd}`,
        `detected=${snapshot.detectedSurfaces.join(', ') || 'none'}`,
        `bridge=${snapshot.bridgeStatus}`,
        `serverUrl=${snapshot.serverUrl}`,
        `serveCommand=${snapshot.serveCommand}`,
        `attachCommand=${snapshot.attachCommand}`,
        `acpCommand=${snapshot.acpCommand}`,
        'steps:',
        ...snapshot.notes.map((note, index) => `${index + 1}. ${note}`),
    ].join('\n'), dependencies);

    return snapshot;
}

export function runIdeCommand(fn: () => void): void {
    try {
        fn();
    } catch (error) {
        process.stderr.write(`ide command failed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}

function detectIdeSurfaces(env: NodeJS.ProcessEnv): DetectedIdeSurface[] {
    const detected = new Set<DetectedIdeSurface>();
    const termProgram = env.TERM_PROGRAM?.trim().toLowerCase();

    if (env.CURSOR_TRACE_ID || env.CURSOR_SESSION_ID || termProgram === 'cursor') {
        detected.add('cursor');
    }
    if (env.VSCODE_PID || env.VSCODE_CWD || termProgram === 'vscode') {
        detected.add('vscode');
    }
    if (env.JETBRAINS_IDE || env.TERMINAL_EMULATOR === 'JetBrains-JediTerm') {
        detected.add('jetbrains');
    }
    if (env.ZED_TERM || termProgram === 'zed') {
        detected.add('zed');
    }

    return [...detected];
}

function quoteShellArg(value: string): string {
    return /\s/.test(value) ? JSON.stringify(value) : value;
}

function writeOutput(output: string, dependencies: IdeCommandDependencies): void {
    if (dependencies.writeOutput) {
        dependencies.writeOutput(output);
        return;
    }

    process.stdout.write(`${output}\n`);
}
