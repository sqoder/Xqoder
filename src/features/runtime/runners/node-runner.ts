// ============================================================
// Node.js Project Runner
// ============================================================

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RuntimeStatus } from '@xqoder/shared';
import { LogWatcher } from '../log-watcher.js';
import { PortDetector } from '../port-detector.js';
import type { PackageManager } from '@xqoder/shared';
import kill from 'tree-kill';
import { PackageManagerDetector } from '../package-manager-detector.js';
import { ProjectDetector } from '../project-detector.js';

/** Runner State */
export interface RunnerState {
    status: RuntimeStatus;
    pid?: number;
    url?: string;
    command?: string;
    port?: number;
    packageManager?: PackageManager;
    errors: string[];
}

/**
 * NodeRunner
 * Automates dependency installation and startup for Node.js projects
 */
export class NodeRunner {
    private process: ChildProcess | null = null;
    private logWatcher: LogWatcher;
    private portDetector: PortDetector;
    private packageManagerDetector: PackageManagerDetector;
    private projectDetector: ProjectDetector;
    private state: RunnerState = { status: RuntimeStatus.Idle, errors: [] };

    constructor() {
        this.logWatcher = new LogWatcher();
        this.portDetector = new PortDetector();
        this.packageManagerDetector = new PackageManagerDetector();
        this.projectDetector = new ProjectDetector(this.packageManagerDetector);
    }

    /**
     * Start Node.js project
     */
    async start(projectDir: string, command?: string, port?: number): Promise<RunnerState> {
        this.state = { status: RuntimeStatus.Starting, errors: [] };
        this.logWatcher.clear();

        // 1. Install dependencies
        const hasNodeModules = fs.existsSync(path.join(projectDir, 'node_modules'));
        if (!hasNodeModules) {
            await this.installDeps(projectDir);
        }

        // 2. Determine startup command
        const detection = this.projectDetector.detect(projectDir);
        const startCmd = command ?? detection.suggestedStartCommand ?? 'node index.js';

        // 3. Determine port
        const targetPort = port ?? detection.suggestedPort ?? 3000;
        const availablePort = await this.portDetector.findAvailablePort(targetPort);
        const packageManager = this.packageManagerDetector.detect(projectDir);
        this.state.command = startCmd;
        this.state.port = availablePort;
        this.state.packageManager = packageManager;

        // 4. Start process
        return new Promise<RunnerState>((resolve) => {
            let settled = false;
            const env = {
                ...process.env,
                PORT: String(availablePort),
                NODE_ENV: 'development',
            };

            this.process = spawn('sh', ['-c', startCmd], {
                cwd: projectDir,
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            this.state.pid = this.process.pid;

            const finalize = (status: RuntimeStatus, extra?: Partial<RunnerState>): void => {
                if (settled) return;
                settled = true;
                this.state = {
                    ...this.state,
                    status,
                    ...extra,
                };
                resolve(this.getState());
            };

            // Listen to output
            this.process.stdout?.on('data', (data: Buffer) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (line.trim()) this.logWatcher.processLine(line, 'stdout');
                }
            });

            this.process.stderr?.on('data', (data: Buffer) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (line.trim()) this.logWatcher.processLine(line, 'stderr');
                }
            });

            // Listen for readiness
            this.logWatcher.on('ready', (url: string) => {
                finalize(RuntimeStatus.Running, { url });
            });

            // Listen for errors
            this.logWatcher.on('error', (error) => {
                this.state.errors.push(error.message);
            });

            // Listen for process exit
            this.process.on('close', (code) => {
                if (this.state.status !== RuntimeStatus.Running) {
                    this.state.errors.push(`Process exited with code: ${code}`);
                    finalize(RuntimeStatus.Error);
                } else {
                    this.state.status = RuntimeStatus.Stopped;
                }
            });

            this.process.on('error', (err) => {
                this.state.errors.push(`Failed to start process: ${err.message}`);
                finalize(RuntimeStatus.Error);
            });

            void this.portDetector.waitForPort(availablePort, '127.0.0.1', 5000, 100)
                .then((isReady) => {
                    if (isReady) {
                        finalize(RuntimeStatus.Running, {
                            url: `http://localhost:${availablePort}`,
                        });
                    }
                })
                .catch(() => {
                    // ignore and allow log-based or timeout-based readiness to decide
                });

            // Timeout handling (30s without response)
            setTimeout(() => {
                if (this.state.status === RuntimeStatus.Starting) {
                    // Process might still be running but no readiness signal detected
                    finalize(RuntimeStatus.Running, {
                        url: `http://localhost:${availablePort}`,
                    });
                }
            }, 30000);
        });
    }

    /** Stop process */
    async stop(): Promise<void> {
        if (this.process?.pid) {
            const pid = this.process.pid;
            await new Promise<void>((resolve) => {
                let resolved = false;
                const finish = (): void => {
                    if (resolved) return;
                    resolved = true;
                    resolve();
                };

                const timer = setTimeout(() => {
                    kill(pid, 'SIGKILL', () => finish());
                }, 5000);

                this.process?.once('close', () => {
                    clearTimeout(timer);
                    finish();
                });

                kill(pid, 'SIGTERM', () => {
                    // Wait for close event or forced kill timer
                });
            });
        }
        this.state.status = RuntimeStatus.Stopped;
        this.process = null;
    }

    /** Get LogWatcher */
    getLogWatcher(): LogWatcher {
        return this.logWatcher;
    }

    /** Get current state */
    getState(): RunnerState {
        return { ...this.state };
    }

    /** Install dependencies */
    private async installDeps(projectDir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const pkgManager = this.packageManagerDetector.detect(projectDir);
            const installCmd = pkgManager === 'bun' ? 'bun install'
                : pkgManager === 'pnpm' ? 'pnpm install'
                : pkgManager === 'yarn' ? 'yarn install'
                    : 'npm install';

            const child = spawn('sh', ['-c', installCmd], {
                cwd: projectDir,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            child.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Dependency installation failed with code: ${code}`));
            });

            child.on('error', (err) => reject(err));
        });
    }
}
