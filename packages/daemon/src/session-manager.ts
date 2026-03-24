import * as net from 'node:net';
import { PassThrough } from 'node:stream';
import * as pty from 'node-pty';
import { Logger, XQoderError } from '@xqoder/shared';
import { createDaemonDoctorReport, createHostedTuiFallbackMessage, type DaemonDoctorReport } from './doctor.js';
import type { CellUpdate, ClientMessage, DaemonMessage } from './ipc-protocol.js';
import { encodeMessage } from './ipc-protocol.js';

export interface SessionManagerOptions {
    nodeBinary: string;
    cliEntrypoint: string;
}

const logger = new Logger('daemon-session');

class HostedTuiUnavailableError extends XQoderError {
    constructor(message: string) {
        super(message, 'PTY_UNAVAILABLE');
        this.name = 'HostedTuiUnavailableError';
    }
}

let cachedDoctorReport: DaemonDoctorReport | null = null;
let cachedDoctorNodeBinary: string | null = null;

function loadDoctorReport(nodeBinary: string): DaemonDoctorReport {
    if (cachedDoctorReport && cachedDoctorNodeBinary === nodeBinary) {
        return cachedDoctorReport;
    }
    cachedDoctorReport = createDaemonDoctorReport(nodeBinary);
    cachedDoctorNodeBinary = nodeBinary;
    return cachedDoctorReport;
}

function randomId(): string {
    return Math.random().toString(36).slice(2);
}

function isPrintableChar(char: string): boolean {
    return !(/[\u0000-\u001F\u007F]/u).test(char);
}

function parseMouseScroll(seq: string): 'up' | 'down' | null {
    const match = /^\x1b\[<(\d+);\d+;\d+[Mm]$/.exec(seq);
    if (!match) {
        return null;
    }
    const code = Number.parseInt(match[1] ?? '', 10);
    if (Number.isNaN(code)) {
        return null;
    }
    if ((code & 0b1100000) === 64) {
        return (code & 0b11) === 0 ? 'up' : 'down';
    }
    return null;
}

type MutableSizedStream = NodeJS.WriteStream & {
    columns?: number;
    rows?: number;
};

function syncStdoutSize(cols: number, rows: number): void {
    const stdout = process.stdout as MutableSizedStream;
    stdout.columns = cols;
    stdout.rows = rows;
    stdout.emit('resize');
}

interface SessionState {
    width: number;
    height: number;
    input: string;
    lines: string[];
    topLine: number;
}

export class ClientSession {
    readonly id: string;
    readonly stdinPassthrough = new PassThrough();
    private socket: net.Socket;
    private options: SessionManagerOptions;
    private hosted: pty.IPty | null = null;
    private frameFallbackActive = false;
    private state: SessionState;
    private previousCells: string[];

    constructor(socket: net.Socket, options: SessionManagerOptions) {
        this.id = randomId();
        this.socket = socket;
        this.options = options;
        this.state = {
            width: 80,
            height: 24,
            input: '',
            lines: [
                'Xqoder daemon session ready.',
                'Type to echo input, Enter to commit line.',
                'Mouse wheel scrolls transcript viewport.',
            ],
            topLine: 0,
        };
        this.previousCells = [];
    }

    handleClientMessage(msg: ClientMessage): void {
        if (msg.type === 'ping') {
            this.send({ type: 'pong' });
            return;
        }

        if (msg.type === 'attach') {
            this.ensureHostedSession();
            if (this.frameFallbackActive) {
                this.renderAndSendFrame();
            }
            return;
        }

        if (msg.type === 'detach') {
            this.destroy();
            this.socket.end();
            return;
        }

        if (this.hosted) {
            this.forwardToHosted(msg);
            return;
        }

        if (!this.frameFallbackActive) {
            return;
        }

        switch (msg.type) {
            case 'key':
                this.stdinPassthrough.push(Buffer.from(msg.data, 'utf8'));
                this.applyKey(msg.data);
                this.renderAndSendFrame();
                break;
            case 'mouse': {
                this.stdinPassthrough.push(Buffer.from(msg.seq, 'utf8'));
                const direction = parseMouseScroll(msg.seq);
                if (direction) {
                    this.applyScroll(direction === 'up' ? -3 : 3);
                    this.renderAndSendFrame();
                }
                break;
            }
            case 'resize':
                this.state.width = Math.max(10, Math.trunc(msg.cols));
                this.state.height = Math.max(4, Math.trunc(msg.rows));
                this.clampTopLine();
                this.previousCells = [];
                this.renderAndSendFrame();
                break;
            default:
                break;
        }
    }

    destroy(): void {
        if (this.hosted) {
            this.hosted.kill();
            this.hosted = null;
        }
    }

    send(msg: DaemonMessage): void {
        if (!this.socket.writable) {
            return;
        }
        this.socket.write(encodeMessage(msg));
    }

    private ensureHostedSession(): void {
        if (this.hosted) {
            return;
        }

        const doctorReport = loadDoctorReport(this.options.nodeBinary);
        if (!doctorReport.spawnSupported) {
            this.handleHostedTuiFailure(
                new HostedTuiUnavailableError(doctorReport.spawnError ?? 'PTY probe failed'),
                doctorReport,
            );
            return;
        }

        const cols = Math.max(10, this.state.width);
        const rows = Math.max(4, this.state.height);
        const shell = this.options.nodeBinary;
        const shellArgs = [this.options.cliEntrypoint, 'tui'];
        let hosted: pty.IPty;
        try {
            hosted = pty.spawn(shell, shellArgs, {
                name: process.env.TERM ?? 'xterm-256color',
                cols,
                rows,
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    XQODER_DAEMON_HOSTED: '1',
                    XQODER_RUST_RENDERER: process.env.XQODER_RUST_RENDERER ?? '0',
                },
            });
        } catch (error) {
            this.handleHostedTuiFailure(
                new HostedTuiUnavailableError(error instanceof Error ? error.message : String(error)),
                doctorReport,
            );
            return;
        }

        this.frameFallbackActive = false;
        syncStdoutSize(cols, rows);
        hosted.onData((data) => {
            this.send({ type: 'ansi', data });
        });

        hosted.onExit(() => {
            this.hosted = null;
            this.send({ type: 'restart' });
        });

        this.hosted = hosted;
    }

    private handleHostedTuiFailure(error: HostedTuiUnavailableError, report: DaemonDoctorReport): void {
        const baseMessage = createHostedTuiFallbackMessage(error, report);
        const message = `${baseMessage} | Frame fallback is permanently disabled; ANSI-only protocol is required.`;
        logger.error('Hosted TUI unavailable; ANSI-only mode forbids frame fallback', error.message);
        this.send({
            type: 'error',
            code: error.code,
            message,
        });
        throw error;
    }

    private activateDebugFrameFallback(): void {
        this.frameFallbackActive = true;
        this.previousCells = [];
        this.state.input = '';
        this.state.topLine = 0;
        this.state.lines = [
            '[DEBUG FRAME FALLBACK ACTIVE]',
            'Hosted PTY failed; this is NOT the real Xqoder UI.',
            'Use only for local debugging with XQODER_ALLOW_FRAME_FALLBACK=1.',
        ];
    }

    private forwardToHosted(msg: Exclude<ClientMessage, { type: 'attach' } | { type: 'detach' } | { type: 'ping' }>): void {
        if (!this.hosted) {
            return;
        }

        switch (msg.type) {
            case 'key':
                this.hosted.write(msg.data);
                break;
            case 'mouse':
                this.hosted.write(msg.seq);
                break;
            case 'resize': {
                const cols = Math.max(10, Math.trunc(msg.cols));
                const rows = Math.max(4, Math.trunc(msg.rows));
                this.state.width = cols;
                this.state.height = rows;
                this.hosted.resize(cols, rows);
                syncStdoutSize(cols, rows);
                break;
            }
            default:
                break;
        }
    }

    private sendFrame(cells: CellUpdate[]): void {
        this.send({ type: 'frame', cells });
    }

    private renderAndSendFrame(): void {
        const total = this.state.width * this.state.height;
        const next = new Array<string>(total).fill(' ');

        const contentHeight = Math.max(1, this.state.height - 1);
        const visible = this.state.lines.slice(this.state.topLine, this.state.topLine + contentHeight);

        visible.forEach((line, row) => {
            for (let col = 0; col < this.state.width; col += 1) {
                const ch = line[col] ?? ' ';
                next[row * this.state.width + col] = ch;
            }
        });

        const prompt = `> ${this.state.input}`;
        const promptRow = this.state.height - 1;
        for (let col = 0; col < this.state.width; col += 1) {
            const ch = prompt[col] ?? ' ';
            next[promptRow * this.state.width + col] = ch;
        }

        const cells: CellUpdate[] = [];
        for (let index = 0; index < total; index += 1) {
            if (this.previousCells[index] === next[index]) {
                continue;
            }
            const row = Math.floor(index / this.state.width);
            const col = index % this.state.width;
            cells.push({ col, row, ch: next[index] ?? ' ' });
        }

        this.previousCells = next;
        if (cells.length > 0) {
            this.sendFrame(cells);
        }
    }

    private applyKey(raw: string): void {
        if (raw === '\r' || raw === '\n') {
            const committed = this.state.input.trim();
            if (committed.length > 0) {
                this.state.lines.push(committed);
            }
            this.state.input = '';
            this.followBottom();
            return;
        }

        if (raw === '\u0008' || raw === '\u007f') {
            this.state.input = this.state.input.slice(0, -1);
            return;
        }

        if (raw === '\u001b[A') {
            this.applyScroll(-1);
            return;
        }

        if (raw === '\u001b[B') {
            this.applyScroll(1);
            return;
        }

        for (const char of raw) {
            if (isPrintableChar(char)) {
                this.state.input += char;
            }
        }
    }

    private applyScroll(delta: number): void {
        const contentHeight = Math.max(1, this.state.height - 1);
        const maxTop = Math.max(0, this.state.lines.length - contentHeight);
        this.state.topLine = Math.min(maxTop, Math.max(0, this.state.topLine + delta));
    }

    private followBottom(): void {
        const contentHeight = Math.max(1, this.state.height - 1);
        this.state.topLine = Math.max(0, this.state.lines.length - contentHeight);
    }

    private clampTopLine(): void {
        const contentHeight = Math.max(1, this.state.height - 1);
        const maxTop = Math.max(0, this.state.lines.length - contentHeight);
        this.state.topLine = Math.min(maxTop, Math.max(0, this.state.topLine));
    }
}

export class SessionManager {
    private sessions = new Map<string, ClientSession>();
    private options: SessionManagerOptions;
    lastActivityTime = Date.now();

    constructor(options: SessionManagerOptions) {
        this.options = options;
    }

    createSession(socket: net.Socket): ClientSession {
        this.lastActivityTime = Date.now();
        const session = new ClientSession(socket, this.options);
        this.sessions.set(session.id, session);
        return session;
    }

    destroySession(id: string): void {
        const session = this.sessions.get(id);
        if (session) {
            session.destroy();
        }
        this.sessions.delete(id);
        this.lastActivityTime = Date.now();
    }

    touch(): void {
        this.lastActivityTime = Date.now();
    }

    activeCount(): number {
        return this.sessions.size;
    }
}
