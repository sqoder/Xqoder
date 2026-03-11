// ============================================================
// ProjectRuntime 核心类
// ============================================================

import { ProjectType, RuntimeStatus, type ProjectConfig, type RuntimeResult } from '@xqoder/shared';
import { Logger, logger as defaultLogger } from '@xqoder/shared';
import { ProjectDetector } from './project-detector.js';
import { NodeRunner } from './runners/node-runner.js';
import { PythonRunner } from './runners/python-runner.js';
import { ErrorAnalyzer, type ErrorAnalysis } from './error-analyzer.js';
import { LogWatcher } from './log-watcher.js';

/**
 * ProjectRuntime
 * 统一管理项目运行生命周期：检测 → 启动 → 监控 → 停止
 */
export class ProjectRuntime {
    private detector: ProjectDetector;
    private errorAnalyzer: ErrorAnalyzer;
    private logger: Logger;

    private nodeRunner: NodeRunner | null = null;
    private pythonRunner: PythonRunner | null = null;
    private projectConfig: ProjectConfig | null = null;

    constructor() {
        this.detector = new ProjectDetector();
        this.errorAnalyzer = new ErrorAnalyzer();
        this.logger = defaultLogger.child('Runtime');
    }

    /**
     * 启动项目
     * 自动检测项目类型并使用对应的 Runner 启动
     */
    async start(projectDir: string, options?: { command?: string; port?: number }): Promise<RuntimeResult> {
        this.logger.info(`启动项目: ${projectDir}`);
        const startedAt = new Date();

        // 1. 检测项目类型
        const detection = this.detector.detect(projectDir);
        this.projectConfig = this.detector.createConfig(projectDir);
        this.logger.info(`项目类型: ${this.projectConfig.type}`);

        // 2. 根据类型启动
        switch (this.projectConfig.type) {
            case ProjectType.Node:
                return this.startNode(projectDir, detection.framework, startedAt, options);
            case ProjectType.Python:
                return this.startPython(projectDir, detection.framework, startedAt, options);
            case ProjectType.Static:
                return this.startStatic(projectDir, startedAt, options);
            default:
                return {
                    status: RuntimeStatus.Error,
                    projectDir,
                    projectType: this.projectConfig.type,
                    framework: detection.framework,
                    command: options?.command,
                    errors: [{
                        type: 'config_error' as any,
                        message: `不支持的项目类型: ${this.projectConfig.type}`,
                    }],
                    logs: [],
                    startedAt,
                    completedAt: new Date(),
                };
        }
    }

    /**
     * 停止项目
     */
    async stop(): Promise<void> {
        this.logger.info('停止项目...');
        if (this.nodeRunner) await this.nodeRunner.stop();
        if (this.pythonRunner) await this.pythonRunner.stop();
        this.nodeRunner = null;
        this.pythonRunner = null;
        this.logger.success('项目已停止');
    }

    /**
     * 获取错误分析
     */
    analyzeErrors(): ErrorAnalysis | null {
        const logWatcher = this.getActiveLogWatcher();
        if (!logWatcher) return null;

        const errorLogs = logWatcher.getErrorLogs();
        const logText = errorLogs.map(l => l.content).join('\n');
        return this.errorAnalyzer.analyze(logText);
    }

    /**
     * 获取最近日志
     */
    getRecentLogs(count: number = 50): string[] {
        const logWatcher = this.getActiveLogWatcher();
        if (!logWatcher) return [];
        return logWatcher.getRecentLogs(count).map(l => l.content);
    }

    /**
     * 获取项目配置
     */
    getProjectConfig(): ProjectConfig | null {
        return this.projectConfig;
    }

    // ---- 私有方法 ----

    private async startNode(
        projectDir: string,
        framework: string | undefined,
        startedAt: Date,
        options?: { command?: string; port?: number },
    ): Promise<RuntimeResult> {
        this.nodeRunner = new NodeRunner();
        const state = await this.nodeRunner.start(projectDir, options?.command, options?.port);

        this.logger.info(`Node.js 项目状态: ${state.status}`);
        if (state.url) {
            this.logger.success(`项目运行地址: ${state.url}`);
        }

        return {
            status: state.status,
            projectDir,
            projectType: ProjectType.Node,
            framework,
            packageManager: state.packageManager,
            command: state.command,
            port: state.port,
            url: state.url,
            pid: state.pid,
            errors: state.errors.map(msg => ({
                type: 'runtime_exception' as any,
                message: msg,
            })),
            logs: this.nodeRunner.getLogWatcher().getRecentLogs().map(l => l.content),
            startedAt,
            completedAt: state.status === RuntimeStatus.Running ? undefined : new Date(),
        };
    }

    private async startPython(
        projectDir: string,
        framework: string | undefined,
        startedAt: Date,
        options?: { command?: string; port?: number },
    ): Promise<RuntimeResult> {
        this.pythonRunner = new PythonRunner();
        const state = await this.pythonRunner.start(projectDir, options?.command, options?.port);

        this.logger.info(`Python 项目状态: ${state.status}`);
        if (state.url) {
            this.logger.success(`项目运行地址: ${state.url}`);
        }

        return {
            status: state.status,
            projectDir,
            projectType: ProjectType.Python,
            framework,
            command: state.command,
            port: state.port,
            url: state.url,
            pid: state.pid,
            errors: state.errors.map(msg => ({
                type: 'runtime_exception' as any,
                message: msg,
            })),
            logs: this.pythonRunner.getLogWatcher().getRecentLogs().map(l => l.content),
            startedAt,
            completedAt: state.status === RuntimeStatus.Running ? undefined : new Date(),
        };
    }

    private async startStatic(
        projectDir: string,
        startedAt: Date,
        options?: { command?: string; port?: number },
    ): Promise<RuntimeResult> {
        // 静态站点使用 NodeRunner + npx serve
        this.nodeRunner = new NodeRunner();
        const port = options?.port ?? 3000;
        const command = options?.command ?? `npx -y serve . -l ${port}`;
        const state = await this.nodeRunner.start(projectDir, command, port);

        return {
            status: state.status,
            projectDir,
            projectType: ProjectType.Static,
            framework: 'static',
            packageManager: state.packageManager,
            command: state.command ?? command,
            port: state.port ?? port,
            url: state.url ?? `http://localhost:${port}`,
            pid: state.pid,
            errors: state.errors.map(msg => ({
                type: 'runtime_exception' as any,
                message: msg,
            })),
            logs: this.nodeRunner.getLogWatcher().getRecentLogs().map(l => l.content),
            startedAt,
            completedAt: state.status === RuntimeStatus.Running ? undefined : new Date(),
        };
    }

    private getActiveLogWatcher(): LogWatcher | null {
        if (this.nodeRunner) return this.nodeRunner.getLogWatcher();
        if (this.pythonRunner) return this.pythonRunner.getLogWatcher();
        return null;
    }
}
