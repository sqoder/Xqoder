import { listCustomCommandReferences } from '@xqoder/shared';
import { WorkflowEngine } from '@xqoder/workflow';
import { ProjectType, StepStatus, type ProjectConfig } from '@xqoder/shared';
import type { InputShortcutIntent } from './input-controller.js';
import type { SessionController } from './session-controller.js';

interface ShortcutControllerDeps {
    dispatch: (event: unknown) => void;
    settingsDir: string;
    attachBaseUrl?: string;
    loadFilepickerEntries: (dir: string) => Array<{ path: string; label: string; isDir: boolean }>;
    markProjectInitialized: (dir: string) => void;
    helpItems: Array<{ key: string; description: string; section?: 'Session' | 'Editor' | 'Navigation' | 'Global'; weight?: number }>;
    themeItems: Array<{ id: string; label: string }>;
    sessionController: SessionController;
    onInterrupt: () => void;
    onQuit: () => void;
    resolveCustomCommand: (id: string) => { variables: string[] } | null;
    executeCustomCommand: (custom: unknown, values: Record<string, string>) => string;
    getCustomArgHistory: (id: string) => Record<string, string> | undefined;
    setCustomArgHistory: (id: string, values: Record<string, string>) => void;
    getActiveSessionId: () => string | undefined;
}

export class ShortcutController {
    constructor(private readonly deps: ShortcutControllerDeps) {}

    handleIntent(intent: InputShortcutIntent, currentState: any, runtime: { completeQuery: string; completeRootDir: string | null }): { handled: boolean; state: { completeQuery: string; completeRootDir: string | null } } {
        const next = { ...runtime };
        switch (intent.type) {
            case 'interrupt':
                this.deps.onInterrupt();
                return { handled: true, state: next };
            case 'overlay.move':
                this.deps.dispatch({ type: 'overlay.move', delta: intent.delta });
                return { handled: true, state: next };
            case 'overlay.escape': {
                const overlay = currentState.overlay;
                if (overlay?.type === 'complete') {
                    next.completeQuery = '';
                    next.completeRootDir = null;
                }
                if (overlay?.type === 'init') {
                    this.deps.markProjectInitialized(this.deps.settingsDir);
                }
                this.deps.dispatch({ type: 'overlay.close' });
                return { handled: true, state: next };
            }
            case 'open.filepicker': {
                const cwd = currentState.cwd ?? this.deps.settingsDir;
                const items = this.deps.loadFilepickerEntries(cwd);
                this.deps.dispatch({ type: 'overlay.open', kind: 'filepicker', currentDir: cwd, items });
                return { handled: true, state: next };
            }
            case 'open.commands': {
                const builtIn: Array<{ id: string; label: string; description: string; pro?: boolean }> = [
                    { id: '/undo', label: '/undo', description: '撤销最后一条消息' },
                    { id: '/compact', label: '/compact', description: '手动压缩上下文' },
                    { id: '/new', label: '/new', description: '新建会话' },
                    { id: '/sessions', label: '/sessions', description: '打开会话列表' },
                    { id: '/export', label: '/export', description: '导出对话为 Markdown' },
                    { id: '/fork', label: '/fork', description: '分叉当前会话' },
                    { id: '/fix', label: '/fix', description: '自动修复错误' },
                    { id: '/deploy', label: '/deploy', description: '部署到云端' },
                    { id: '/docker', label: '/docker', description: '启动沙盒环境' },
                    { id: '/stats', label: '/stats', description: '查看成本统计' },
                    { id: '/rollback', label: '/rollback', description: '回滚文件改动' },
                    { id: '/share', label: '/share', description: '生成分享链接', pro: true },
                    { id: 'help', label: 'Show Help', description: 'Open keyboard shortcuts and usage tips' },
                    { id: 'session', label: 'Switch Session', description: 'Open recent sessions and restore one' },
                    { id: 'newSession', label: 'New Session', description: 'Reset editor and start a fresh chat' },
                    { id: 'model', label: 'Select Model', description: 'Choose provider and model for this session' },
                    { id: 'filepicker', label: 'Pick File', description: 'Attach files from current project directory' },
                    { id: 'pro.workflow.deploy', label: 'Deploy Workflow', description: 'One-click CI/CD deploy', pro: true },
                    { id: 'quit', label: 'Quit', description: 'Exit terminal interface' },
                ];
                const custom = listCustomCommandReferences(this.deps.settingsDir).map((command) => ({
                    ...command,
                    description: `Run custom command ${command.id}`,
                }));
                this.deps.dispatch({ type: 'overlay.open', kind: 'commands', items: [...builtIn, ...custom] });
                return { handled: true, state: next };
            }
            case 'open.theme':
                this.deps.dispatch({ type: 'overlay.open', kind: 'theme', items: this.deps.themeItems });
                return { handled: true, state: next };
            case 'open.help':
                this.deps.dispatch({ type: 'overlay.open', kind: 'help', items: this.deps.helpItems });
                return { handled: true, state: next };
            case 'open.session':
                this.deps.sessionController.openSessionOverlay(this.deps.settingsDir, this.deps.attachBaseUrl);
                return { handled: true, state: next };
            case 'new.session':
                this.deps.sessionController.createNewSession(this.deps.settingsDir, this.deps.attachBaseUrl);
                return { handled: true, state: next };
            case 'open.model':
                this.deps.sessionController.openModelOverlay(this.deps.settingsDir, currentState.model, currentState.model);
                return { handled: true, state: next };
            default:
                return { handled: false, state: next };
        }
    }

    runPaletteCommand(commandId: string, currentModel?: string): void {
        const slashCmd = commandId.trim();
        const knownSlashCommands = new Set(['/undo', '/compact', '/new', '/sessions', '/export', '/fork', '/fix', '/deploy', '/docker', '/stats', '/rollback', '/share']);
        if (knownSlashCommands.has(slashCmd)) {
            this.deps.dispatch({
                type: 'editor.set-value',
                value: slashCmd,
                cursorOffset: slashCmd.length,
            });
            this.deps.dispatch({ type: 'notice.set', notice: `已写入命令到输入框：${slashCmd}（回车发送）` });
            return;
        }

        if (commandId === 'help') {
            this.deps.dispatch({ type: 'overlay.open', kind: 'help', items: this.deps.helpItems });
            return;
        }
        if (commandId === 'session') {
            this.deps.sessionController.openSessionOverlay(this.deps.settingsDir, this.deps.attachBaseUrl);
            return;
        }
        if (commandId === 'newSession') {
            this.deps.sessionController.createNewSession(this.deps.settingsDir, this.deps.attachBaseUrl);
            return;
        }
        if (commandId === 'model') {
            this.deps.sessionController.openModelOverlay(this.deps.settingsDir, currentModel, currentModel);
            return;
        }
        if (commandId === 'filepicker') {
            const items = this.deps.loadFilepickerEntries(this.deps.settingsDir);
            this.deps.dispatch({ type: 'overlay.open', kind: 'filepicker', currentDir: this.deps.settingsDir, items });
            return;
        }
        if (commandId === 'quit') {
            this.deps.onQuit();
            return;
        }

        if (commandId.trim().startsWith('pro.workflow.deploy')) {
            const sessionId = this.deps.getActiveSessionId() ?? 'tui-session';
            const now = Date.now();
            const emitCalled = (timestamp: number, tool: string, args: unknown) => this.deps.dispatch({
                type: 'ui.tool.feedback.called',
                sessionId,
                timestamp,
                tool,
                args: args as import('@xqoder/protocol').JsonValue,
            });
            const emitOutput = (timestamp: number, tool: string, output: string) => this.deps.dispatch({
                type: 'ui.tool.feedback.output',
                sessionId,
                timestamp,
                tool,
                output,
                partial: false,
            });
            const emitCompleted = (timestamp: number, tool: string, success: boolean, metadata?: Record<string, unknown>) => this.deps.dispatch({
                type: 'ui.tool.feedback.completed',
                sessionId,
                timestamp,
                tool,
                success,
                ...(metadata ? { metadata } : {}),
            });

            const tool = 'workflow';
            emitCalled(now, tool, { name: 'deploy' });

            const projectConfig: ProjectConfig = {
                rootDir: this.deps.settingsDir,
                type: ProjectType.Unknown,
                name: 'project',
            };

            const steps = [
                { name: 'detect', label: '检测项目结构' },
                { name: 'deps', label: '安装缺失依赖' },
                { name: 'tests', label: '运行测试套件' },
                { name: 'deploy', label: '提交并部署' },
            ];

            const statusGlyph = (status: 'done' | 'running' | 'pending') => {
                if (status === 'done') return '●';
                if (status === 'running') return '◉';
                return '○';
            };

            const renderBlock = (runningIndex: number, doneUpTo: number) => {
                const lines = steps.map((s, idx) => {
                    const status: 'done' | 'running' | 'pending' =
                        idx < doneUpTo ? 'done' : idx === runningIndex ? 'running' : 'pending';
                    const badge = status === 'done' ? '[done]' : status === 'running' ? '[···]' : '[pending]';
                    return `▏${statusGlyph(status)} Step ${idx + 1}/${steps.length}  ${s.label}  ${badge}`;
                });
                return [
                    '正在执行：部署流程',
                    '',
                    ...lines,
                ].join('\n');
            };

            void (async () => {
                try {
                    const engine = new WorkflowEngine();
                    // 用“空步骤”驱动回调，专注展示 UI（真正 deploy 可在 Week5+ 接入）
                    steps.forEach((s) => {
                        engine.addStep({
                            name: s.name,
                            description: s.label,
                            execute: async () => ({ stepName: s.name, status: StepStatus.Completed, startedAt: new Date(), completedAt: new Date() }),
                            validate: async () => true,
                        });
                    });

                    await engine.execute('deploy', projectConfig, {
                        onStepStart: (stepName, index, total) => {
                            void stepName;
                            void total;
                            emitOutput(Date.now(), tool, renderBlock(index, index));
                        },
                        onStepComplete: (result) => {
                            const idx = steps.findIndex((s) => s.name === result.stepName);
                            const doneUpTo = idx >= 0 ? idx + 1 : 0;
                            emitOutput(Date.now(), tool, renderBlock(Math.min(doneUpTo, steps.length - 1), doneUpTo));
                        },
                    });

                    emitCompleted(Date.now(), tool, true, { workflow: 'deploy' });
                    this.deps.dispatch({ type: 'notice.set', notice: 'Workflow completed' });
                } catch (err) {
                    emitCompleted(Date.now(), tool, false, {
                        workflow: 'deploy',
                        error: err instanceof Error ? err.message : String(err),
                    });
                    this.deps.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                }
            })();
            return;
        }

        if (commandId.startsWith('pro.')) {
            this.deps.dispatch({ type: 'notice.set', notice: 'Pro feature preview (coming soon)' });
            return;
        }

        const custom = this.deps.resolveCustomCommand(commandId);
        if (!custom) {
            return;
        }
        if (custom.variables.length > 0) {
            this.deps.dispatch({
                type: 'overlay.open',
                kind: 'arguments',
                commandName: commandId,
                variables: custom.variables,
                initialValues: this.deps.getCustomArgHistory(commandId),
            });
            return;
        }
        try {
            const out = this.deps.executeCustomCommand(custom, {});
            this.deps.dispatch({ type: 'notice.set', notice: out ? out.slice(0, 80) + (out.length > 80 ? '…' : '') : 'Done' });
        } catch (err) {
            this.deps.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
        }
    }
}
