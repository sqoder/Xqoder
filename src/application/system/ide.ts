import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DEFAULT_IDE_HOST = '127.0.0.1';
const DEFAULT_IDE_PORT = 4096;

export interface IdeDiagnostic {
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning' | 'info' | 'hint';
    message: string;
    code?: string;
}

export interface IdeEdit {
    file: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    newText: string;
}

export interface IdeState {
    activeFile?: string;
    selection?: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    diagnostics: IdeDiagnostic[];
}

export interface IdeCommandOutputOptions {
    cwd?: string;
    dir?: string;
    json?: boolean;
    host?: string;
    port?: number | string;
}

export interface IdeCommandDependencies {
    writeOutput?: (output: string) => void;
    createBridge?: (cwd: string) => Pick<IdeBridge, 'getActiveState' | 'getWorkspaceDiagnostics'>;
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
    tuiAttachCommand: string;
    runAttachCommand: string;
    attachCommand: string;
    acpCommand: string;
    notes: string[];
}

export class IdeBridge {
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    async getWorkspaceDiagnostics(): Promise<IdeDiagnostic[]> {
        // In a real implementation, this would query the IDE via a local socket or shared file.
        // For the replica, we'll try to read from a common location or return an empty list.
        const diagnosticsPath = path.join(this.workspaceRoot, '.xqoder', 'ide', 'diagnostics.json');
        try {
            const data = await fs.readFile(diagnosticsPath, 'utf8');
            return JSON.parse(data) as IdeDiagnostic[];
        } catch {
            return [];
        }
    }

    async applyEdits(edits: IdeEdit[]): Promise<{ success: boolean; error?: string }> {
        // In a real implementation, this would send a command to the IDE.
        // For the replica, we'll write an edit request file that an IDE extension could pick up.
        const editsPath = path.join(this.workspaceRoot, '.xqoder', 'ide', 'edits-pending.json');
        try {
            await fs.mkdir(path.dirname(editsPath), { recursive: true });
            await fs.writeFile(editsPath, JSON.stringify(edits, null, 2));
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }

    async getActiveState(): Promise<IdeState> {
        const statePath = path.join(this.workspaceRoot, '.xqoder', 'ide', 'state.json');
        try {
            const data = await fs.readFile(statePath, 'utf8');
            return JSON.parse(data) as IdeState;
        } catch {
            return { diagnostics: [] };
        }
    }
}

export function createIdeSnapshot(
    options: IdeCommandOutputOptions = {},
    env: NodeJS.ProcessEnv = process.env,
): IdeSnapshot {
    const cwd = resolveIdeCwd(options);
    const host = options.host?.trim() || DEFAULT_IDE_HOST;
    const port = normalizeIdePort(options.port);
    const serverUrl = `http://${host}:${port}`;
    const serveCommand = `xqoder serve --dir ${quoteShellArg(cwd)} --hostname ${host} --port ${port}`;
    const tuiAttachCommand = `xqoder tui --hostname ${host} --port ${port} --dir ${quoteShellArg(cwd)}`;
    const runAttachCommand = `xqoder run "<message>" --attach ${serverUrl} --dir ${quoteShellArg(cwd)}`;

    return {
        cwd,
        detectedSurfaces: detectIdeSurfaces(env),
        bridgeStatus: 'not-configured',
        host,
        port,
        serverUrl,
        serveCommand,
        tuiAttachCommand,
        runAttachCommand,
        attachCommand: tuiAttachCommand,
        acpCommand: runAttachCommand,
        notes: [
            'Start `xqoder serve` inside the project the IDE should control.',
            'Attach an interactive terminal with `xqoder tui --hostname ... --port ... --dir ...`.',
            'Use `xqoder run "<message>" --attach ... --dir ...` for non-interactive remote turns.',
            'VS Code extension source lives in `apps/vscode-extension`; run `npm install && npm run build` there before launching an extension host.',
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
        `tuiAttachCommand=${snapshot.tuiAttachCommand}`,
        `runAttachCommand=${snapshot.runAttachCommand}`,
        'steps:',
        ...snapshot.notes.map((note, index) => `${index + 1}. ${note}`),
    ].join('\n'), dependencies);

    return snapshot;
}

export async function runShowIdeStateCommand(
    options: IdeCommandOutputOptions = {},
    dependencies: IdeCommandDependencies = {},
): Promise<IdeState> {
    const bridge = createIdeBridge(options, dependencies);
    const state = await bridge.getActiveState();
    writeOutput(JSON.stringify(state, null, 2), dependencies);
    return state;
}

export async function runShowIdeDiagnosticsCommand(
    options: IdeCommandOutputOptions = {},
    dependencies: IdeCommandDependencies = {},
): Promise<IdeDiagnostic[]> {
    const bridge = createIdeBridge(options, dependencies);
    const diagnostics = await bridge.getWorkspaceDiagnostics();
    writeOutput(JSON.stringify(diagnostics, null, 2), dependencies);
    return diagnostics;
}

export function runIdeCommand(fn: () => void): void {
    try {
        fn();
    } catch (error) {
        failIdeCommand(error);
    }
}

export async function runIdeAsyncCommand(fn: () => Promise<unknown>): Promise<void> {
    try {
        await fn();
    } catch (error) {
        failIdeCommand(error);
    }
}

function createIdeBridge(
    options: IdeCommandOutputOptions,
    dependencies: IdeCommandDependencies,
): Pick<IdeBridge, 'getActiveState' | 'getWorkspaceDiagnostics'> {
    return dependencies.createBridge?.(resolveIdeCwd(options)) ?? new IdeBridge(resolveIdeCwd(options));
}

function resolveIdeCwd(options: Pick<IdeCommandOutputOptions, 'cwd' | 'dir'>): string {
    return path.resolve(options.cwd ?? options.dir ?? process.cwd());
}

function normalizeIdePort(value: number | string | undefined): number {
    const parsed = typeof value === 'string'
        ? Number.parseInt(value, 10)
        : value;
    return Number.isFinite(parsed) && (parsed ?? 0) > 0
        ? Number(parsed)
        : DEFAULT_IDE_PORT;
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
    (dependencies.writeOutput ?? console.log)(output);
}

function failIdeCommand(error: unknown): never {
    process.stderr.write(`ide command failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
}
