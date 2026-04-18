// ============================================================
// ProjectRuntime Core Class
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
 * Manages the project runtime lifecycle: detection → startup → monitoring → stopping
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
     * Start project
     * Automatically detects project type and uses the appropriate Runner to start
     */
    async start(projectDir: string, options?: { command?: string; port?: number }): Promise<RuntimeResult> {
        this.logger.info(`Starting project: ${projectDir}`);
        const startedAt = new Date();

        // 1. Detect project type
        const detection = this.detector.detect(projectDir);
        this.projectConfig = this.detector.createConfig(projectDir);
        this.logger.info(`Project type: ${this.projectConfig.type}`);

        // 2. Start based on type
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
                        message: `Unsupported project type: ${this.projectConfig.type}`,
                    }],
                    logs: [],
                    startedAt,
                    completedAt: new Date(),
                };
        }
    }

    /**
     * Stop project
     */
    async stop(): Promise<void> {
        this.logger.info('Stopping project...');
        if (this.nodeRunner) await this.nodeRunner.stop();
        if (this.pythonRunner) await this.pythonRunner.stop();
        this.nodeRunner = null;
        this.pythonRunner = null;
        this.logger.success('Project stopped');
    }

    /**
     * Get error analysis
     */
    analyzeErrors(): ErrorAnalysis | null {
        const logWatcher = this.getActiveLogWatcher();
        if (!logWatcher) return null;

        const errorLogs = logWatcher.getErrorLogs();
        const logText = errorLogs.map(l => l.content).join('\n');
        return this.errorAnalyzer.analyze(logText);
    }

    /**
     * Get recent logs
     */
    getRecentLogs(count: number = 50): string[] {
        const logWatcher = this.getActiveLogWatcher();
        if (!logWatcher) return [];
        return logWatcher.getRecentLogs(count).map(l => l.content);
    }

    /**
     * Get project configuration
     */
    getProjectConfig(): ProjectConfig | null {
        return this.projectConfig;
    }

    // ---- Private Methods ----

    private async startNode(
        projectDir: string,
        framework: string | undefined,
        startedAt: Date,
        options?: { command?: string; port?: number },
    ): Promise<RuntimeResult> {
        this.nodeRunner = new NodeRunner();
        const state = await this.nodeRunner.start(projectDir, options?.command, options?.port);

        this.logger.info(`Node.js project status: ${state.status}`);
        if (state.url) {
            this.logger.success(`Project running at: ${state.url}`);
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

        this.logger.info(`Python project status: ${state.status}`);
        if (state.url) {
            this.logger.success(`Project running at: ${state.url}`);
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
        // Static sites use NodeRunner + npx serve
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
