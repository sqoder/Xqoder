// ============================================================
// Python 项目运行器
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
 * 自动化 Python 项目的虚拟环境创建、依赖安装和启动
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
     * 启动 Python 项目
     */
    async start(projectDir: string, command?: string, port?: number): Promise<RunnerState> {
        this.state = { status: RuntimeStatus.Starting, errors: [] };

        // 1. 创建/激活虚拟环境
        const venvDir = path.join(projectDir, '.venv');
        if (!fs.existsSync(venvDir)) {
            await this.createVenv(projectDir);
        }

        // 2. 安装依赖
        await this.installDeps(projectDir, venvDir);

        // 3. 确定启动命令
        const startCmd = command ?? this.detectStartCommand(projectDir);

        // 4. 确定端口
        const targetPort = port ?? 8000;
        const availablePort = await this.portDetector.findAvailablePort(targetPort);
        this.state.command = startCmd;
        this.state.port = availablePort;

        // 5. 启动进程
        return new Promise<RunnerState>((resolve) => {
            const pythonBin = path.join(venvDir, 'bin', 'python');
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

            // 监听输出
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

            // 监听就绪
            this.logWatcher.on('ready', (url: string) => {
                this.state.status = RuntimeStatus.Running;
                this.state.url = url;
                resolve(this.state);
            });

            // 监听错误
            this.logWatcher.on('error', (error) => {
                this.state.errors.push(error.message);
            });

            // 监听进程退出
            this.process.on('close', (code) => {
                if (this.state.status !== RuntimeStatus.Running) {
                    this.state.status = RuntimeStatus.Error;
                    this.state.errors.push(`进程退出，退出码: ${code}`);
                    resolve(this.state);
                } else {
                    this.state.status = RuntimeStatus.Stopped;
                }
            });

            this.process.on('error', (err) => {
                this.state.status = RuntimeStatus.Error;
                this.state.errors.push(`进程启动失败: ${err.message}`);
                resolve(this.state);
            });

            // 超时
            setTimeout(() => {
                if (this.state.status === RuntimeStatus.Starting) {
                    this.state.status = RuntimeStatus.Running;
                    this.state.url = `http://localhost:${availablePort}`;
                    resolve(this.state);
                }
            }, 30000);
        });
    }

    /** 停止进程 */
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

    /** 获取 LogWatcher */
    getLogWatcher(): LogWatcher {
        return this.logWatcher;
    }

    /** 获取当前状态 */
    getState(): RunnerState {
        return { ...this.state };
    }

    /** 创建虚拟环境 */
    private async createVenv(projectDir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn('python3', ['-m', 'venv', '.venv'], {
                cwd: projectDir,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            child.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`虚拟环境创建失败，退出码: ${code}`));
            });

            child.on('error', (err) => reject(err));
        });
    }

    /** 安装依赖 */
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
                else reject(new Error(`Python 依赖安装失败，退出码: ${code}`));
            });

            child.on('error', (err) => reject(err));
        });
    }

    /** 检测启动命令 */
    private detectStartCommand(dir: string): string {
        if (fs.existsSync(path.join(dir, 'manage.py'))) {
            return 'python manage.py runserver';
        }
        if (fs.existsSync(path.join(dir, 'app.py'))) {
            return 'python app.py';
        }
        if (fs.existsSync(path.join(dir, 'main.py'))) {
            // 检查是否是 FastAPI 项目
            const mainContent = fs.readFileSync(path.join(dir, 'main.py'), 'utf-8');
            if (mainContent.includes('FastAPI') || mainContent.includes('fastapi')) {
                return 'uvicorn main:app --reload';
            }
            return 'python main.py';
        }
        return 'python main.py';
    }
}
