// ============================================================
// Python Project Runner
// ============================================================

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RuntimeStatus } from '@xqoder/shared';
import { LogWatcher } from '../log-watcher.js';
import { PortDetector } from '../port-detector.js';
import type { RunnerState } from './node-runner.js';

/**
 * PythonRunner
 * Automates virtual environment creation, dependency installation, and startup for Python projects
 */
export class PythonRunner {
    private process: ChildProcess | null = null;
    private logWatcher: LogWatcher;
    private portDetector: PortDetector;
    private state: RunnerState = { status: RuntimeStatus.Idle, errors: [] };

    constructor() {
        this.logWatcher = new LogWatcher();
        this.portDetector = new PortDetector();
    }

    /**
     * Start Python project
     */
    async start(projectDir: string, command?: string, port?: number): Promise<RunnerState> {
        this.state = { status: RuntimeStatus.Starting, errors: [] };

        // 1. Create/activate virtual environment
        const venvDir = path.join(projectDir, '.venv');
        if (!fs.existsSync(venvDir)) {
            await this.createVenv(projectDir);
        }

        // 2. Install dependencies
        await this.installDeps(projectDir, venvDir);

        // 3. Determine startup command
        const startCmd = command ?? this.detectStartCommand(projectDir);

        // 4. Determine port
        const targetPort = port ?? 8000;
        const availablePort = await this.portDetector.findAvailablePort(targetPort);
        this.state.command = startCmd;
        this.state.port = availablePort;

        // 5. Start process
        return new Promise<RunnerState>((resolve) => {
            const activatePrefix = `source ${path.join(venvDir, 'bin', 'activate')} && `;
            const fullCmd = `${activatePrefix}${startCmd}`;

            const env = {
                ...process.env,
                PORT: String(availablePort),
                VIRTUAL_ENV: venvDir,
                PATH: `${path.join(venvDir, 'bin')}:${process.env['PATH'] ?? ''}`,
            };

            this.process = spawn('sh', ['-c', fullCmd], {
                cwd: projectDir,
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            this.state.pid = this.process.pid;

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
                this.state.status = RuntimeStatus.Running;
                this.state.url = url;
                resolve(this.state);
            });

            // Listen for errors
            this.logWatcher.on('error', (error) => {
                this.state.errors.push(error.message);
            });

            // Listen for process exit
            this.process.on('close', (code) => {
                if (this.state.status !== RuntimeStatus.Running) {
                    this.state.status = RuntimeStatus.Error;
                    this.state.errors.push(`Process exited with code: ${code}`);
                    resolve(this.state);
                } else {
                    this.state.status = RuntimeStatus.Stopped;
                }
            });

            this.process.on('error', (err) => {
                this.state.status = RuntimeStatus.Error;
                this.state.errors.push(`Failed to start process: ${err.message}`);
                resolve(this.state);
            });

            // Timeout
            setTimeout(() => {
                if (this.state.status === RuntimeStatus.Starting) {
                    this.state.status = RuntimeStatus.Running;
                    this.state.url = `http://localhost:${availablePort}`;
                    resolve(this.state);
                }
            }, 30000);
        });
    }

    /** Stop process */
    async stop(): Promise<void> {
        if (this.process && !this.process.killed) {
            this.process.kill('SIGTERM');
            await new Promise<void>((resolve) => {
                const timer = setTimeout(() => {
                    if (this.process && !this.process.killed) {
                        this.process.kill('SIGKILL');
                    }
                    resolve();
                }, 5000);

                this.process?.on('close', () => {
                    clearTimeout(timer);
                    resolve();
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

    /** Create virtual environment */
    private async createVenv(projectDir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn('python3', ['-m', 'venv', '.venv'], {
                cwd: projectDir,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            child.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Virtual environment creation failed with code: ${code}`));
            });

            child.on('error', (err) => reject(err));
        });
    }

    /** Install dependencies */
    private async installDeps(projectDir: string, venvDir: string): Promise<void> {
        const reqFile = path.join(projectDir, 'requirements.txt');
        if (!fs.existsSync(reqFile)) return;

        return new Promise((resolve, reject) => {
            const pip = path.join(venvDir, 'bin', 'pip');
            const child = spawn(pip, ['install', '-r', 'requirements.txt'], {
                cwd: projectDir,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            child.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Python dependency installation failed with code: ${code}`));
            });

            child.on('error', (err) => reject(err));
        });
    }

    /** Detect startup command */
    private detectStartCommand(dir: string): string {
        if (fs.existsSync(path.join(dir, 'manage.py'))) {
            return 'python manage.py runserver';
        }
        if (fs.existsSync(path.join(dir, 'app.py'))) {
            return 'python app.py';
        }
        if (fs.existsSync(path.join(dir, 'main.py'))) {
            // Check if it is a FastAPI project
            const mainContent = fs.readFileSync(path.join(dir, 'main.py'), 'utf-8');
            if (mainContent.includes('FastAPI') || mainContent.includes('fastapi')) {
                return 'uvicorn main:app --reload';
            }
            return 'python main.py';
        }
        return 'python main.py';
    }
}
