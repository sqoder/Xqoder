import * as path from 'node:path';
import type { SandboxMode, TuiMouseMode } from '@xqoder/shared';
import { loadCustomCommands } from '@xqoder/shared';

export interface TuiSettings {
    dir: string;
    model: string;
    agent: string;
    scope?: string;
    sandboxMode: SandboxMode;
    /** 启动时恢复的 session ID（OpenCode -c/-s） */
    initialSessionId?: string;
    /** 启动时发送的 prompt（OpenCode --prompt） */
    initialPrompt?: string;
}

export type TuiExecutableCommandName =
    | 'chat'
    | 'rollbacks'
    | 'doctor'
    | 'build'
    | 'fix'
    | 'run'
    | 'start'
    | 'test'
    | 'deploy';

export interface TuiExecutableCommand {
    type: 'execute';
    command: TuiExecutableCommandName;
    description?: string;
}

export type TuiCommand =
    | TuiExecutableCommand
    | { type: 'shell'; cmd: string }
    | {
        type: 'session_action';
        action: 'list' | 'show' | 'resume';
        sessionId?: string;
    }
    | {
        type: 'share_action';
        action: 'create' | 'list' | 'show' | 'remove';
        sessionId?: string;
        shareId?: string;
    }
    | { type: 'set_dir'; dir: string }
    | { type: 'set_model'; model: string }
    | { type: 'set_agent'; agent: string }
    | { type: 'set_scope'; scope?: string }
    | { type: 'set_sandbox_mode'; sandboxMode: SandboxMode }
    | { type: 'set_mouse_mode'; mouseMode: TuiMouseMode }
    | { type: 'open_dialog'; dialog: 'theme' | 'model' | 'session' | 'commandPalette' }
    | { type: 'compact' }
    | { type: 'undo' }
    | { type: 'redo' }
    | { type: 'copy' }
    | { type: 'copy_session' }
    | { type: 'copy_code' }
    | { type: 'help' | 'clear' | 'exit' }
    | { type: 'details' }
    | { type: 'diff' }
    | { type: 'timeline' }
    | { type: 'timeline_nav'; direction: 'next' | 'prev' | 'toggle' }
    | { type: 'timeline_focus'; panel: 'tool' | 'diff' | 'timeline' }
    | { type: 'logs' }
    | { type: 'context' }
    | { type: 'custom_command'; name: string }
    | { type: 'editor' }
    | { type: 'export_md' }
    | { type: 'init' }
    | { type: 'thinking' }
    | { type: 'unshare' }
    | { type: 'connect' }
    | { type: 'error'; message: string };

export function parseTuiCommand(input: string, settings: TuiSettings): TuiCommand {
    const trimmed = input.trim();
    if (!trimmed) {
        return { type: 'error', message: 'Please enter a message or command.' };
    }

    if (!trimmed.startsWith('/')) {
        // ! 前缀 — shell 命令
        if (trimmed.startsWith('!')) {
            const cmd = trimmed.slice(1).trim();
            return cmd
                ? { type: 'shell', cmd }
                : { type: 'error', message: 'Usage: !<shell command>  e.g. !ls src/' };
        }
        return {
            type: 'execute',
            command: 'chat',
            description: trimmed,
        };
    }

    const commandBody = trimmed.slice(1);
    const separatorIndex = commandBody.indexOf(' ');
    const commandName = (separatorIndex === -1 ? commandBody : commandBody.slice(0, separatorIndex)).toLowerCase();
    const value = separatorIndex === -1 ? '' : commandBody.slice(separatorIndex + 1).trim();

    switch (commandName) {
        case 'chat':
            return value
                ? { type: 'execute', command: 'chat', description: value }
                : { type: 'error', message: 'Usage: /chat <message>' };
        case 'sessions':
            // /sessions 不带参数 → 打开可视化面板；带参数 → 文字操作
            if (!value) return { type: 'open_dialog', dialog: 'session' };
            return parseSessionsCommand(value);
        case 'resume':
            return value
                ? { type: 'session_action', action: 'resume', sessionId: value }
                : { type: 'session_action', action: 'resume' };
        case 'share':
            return parseShareCommand(value);
        case 'rollbacks':
            return { type: 'execute', command: 'rollbacks' };
        case 'doctor':
            return { type: 'execute', command: 'doctor' };
        case 'build':
            return value
                ? { type: 'execute', command: 'build', description: value }
                : { type: 'error', message: 'Usage: /build <project request>' };
        case 'fix':
        case 'run':
        case 'start':
        case 'test':
        case 'deploy':
            return { type: 'execute', command: commandName as TuiExecutableCommandName };
        case 'dir':
            return value
                ? { type: 'set_dir', dir: resolveCommandPath(settings.dir, value) }
                : { type: 'error', message: 'Usage: /dir <project directory>' };
        case 'theme':
            return { type: 'open_dialog', dialog: 'theme' };
        case 'models':
        case 'model':
            // /models 或 /model 不带参数 → 打开模型选择面板；带参数 → 直接设置
            if (!value) return { type: 'open_dialog', dialog: 'model' };
            return { type: 'set_model', model: value };
        case 'compact':
        case 'summarize':
            return { type: 'compact' };
        case 'undo':
            return { type: 'undo' };
        case 'redo':
            return { type: 'redo' };
        case 'copy':
            return { type: 'copy' };
        case 'copysession':
        case 'copy-session':
            return { type: 'copy_session' };
        case 'copycode':
        case 'copy-code':
            return { type: 'copy_code' };
        case 'details':
            return { type: 'details' };
        case 'diff':
            return { type: 'diff' };
        case 'timeline':
            if (value === 'next') return { type: 'timeline_nav', direction: 'next' };
            if (value === 'prev') return { type: 'timeline_nav', direction: 'prev' };
            if (value === 'toggle') return { type: 'timeline_nav', direction: 'toggle' };
            if (value === 'focus tool') return { type: 'timeline_focus', panel: 'tool' };
            if (value === 'focus diff') return { type: 'timeline_focus', panel: 'diff' };
            if (value === 'focus timeline') return { type: 'timeline_focus', panel: 'timeline' };
            return { type: 'timeline' };
        case 'logs':
            return { type: 'logs' };
        case 'context':
            return { type: 'context' };
        case 'editor':
            return { type: 'editor' };
        case 'export':
            return { type: 'export_md' };
        case 'init':
            return { type: 'init' };
        case 'thinking':
            return { type: 'thinking' };
        case 'unshare':
            return { type: 'unshare' };
        case 'connect':
            return { type: 'connect' };
        case 'new':
        case 'clear':
            return { type: 'clear' };
        case 'agent':
            return value
                ? { type: 'set_agent', agent: value }
                : { type: 'error', message: 'Usage: /agent <agent-name>' };
        case 'scope':
            return { type: 'set_scope', scope: value || undefined };
        case 'sandbox':
            return parseSandboxModeCommand(value);
        case 'mouse':
            return parseMouseModeCommand(value);
        case 'help':
            return { type: 'help' };
        case 'exit':
        case 'quit':
        case 'q':
            return { type: 'exit' };
        case 'continue':
            return value
                ? { type: 'session_action', action: 'resume', sessionId: value }
                : { type: 'session_action', action: 'resume' };
        case 'themes':
            return { type: 'open_dialog', dialog: 'theme' };
        default: {
            const customCmds = loadCustomCommands();
            const match = customCmds.find(c => c.name === commandName);
            if (match) {
                return { type: 'custom_command', name: match.name };
            }
            return { type: 'error', message: `Unknown command: /${commandName}` };
        }
    }
}

export function buildCliArgs(
    command: TuiExecutableCommand,
    settings: TuiSettings,
    options: {
        sessionId?: string;
    } = {},
): string[] {
    switch (command.command) {
        case 'chat':
            return [
                'chat',
                command.description ?? '',
                '--dir',
                settings.dir,
                '--model',
                settings.model,
                '--agent',
                settings.agent,
                ...(options.sessionId ? ['--session', options.sessionId] : []),
            ];
        case 'rollbacks':
            return [
                'rollbacks',
                'list',
                '--dir',
                settings.dir,
            ];
        case 'doctor':
            return ['config', 'doctor'];
        case 'build':
            return [
                'build',
                command.description ?? '',
                '--dir',
                settings.dir,
                '--model',
                settings.model,
                '--agent',
                settings.agent,
            ];
        case 'fix':
            return [
                'fix',
                '--dir',
                settings.dir,
                '--model',
                settings.model,
                '--agent',
                settings.agent,
            ];
        case 'run':
        case 'start':
            return [
                'start',
                '--dir',
                settings.dir,
            ];
        case 'test':
            return [
                'test',
                '--dir',
                settings.dir,
            ];
        case 'deploy':
            return [
                'deploy',
                '--dir',
                settings.dir,
                ...(settings.scope ? ['--scope', settings.scope] : []),
            ];
        default:
            return [];
    }
}

export function formatCliInvocation(args: string[]): string {
    return args
        .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
        .join(' ');
}

/** 所有可用的 slash 命令定义，供补全菜单使用 */
export interface SlashCommandDef {
    name: string;       // 不含 /，如 "theme"
    description: string;
    args?: string;      // 可选参数提示，如 "<模型名>"
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
    { name: 'theme',    description: 'Open theme selector' },
    { name: 'themes',   description: 'Same as /theme' },
    { name: 'models',   description: 'Open model selector', args: '[<model-name>]' },
    { name: 'sessions', description: 'Open session switcher', args: '[show <id>]' },
    { name: 'resume',   description: 'Resume session', args: '[<id>]' },
    { name: 'continue', description: 'Same as /resume' },
    { name: 'compact',  description: 'Compact current context' },
    { name: 'summarize', description: 'Same as /compact' },
    { name: 'undo',     description: 'Rollback previous file snapshot' },
    { name: 'redo',     description: 'Redo last undo action' },
    { name: 'copy',        description: 'Copy latest AI response' },
    { name: 'copysession', description: 'Copy full session transcript' },
    { name: 'copycode',    description: 'Copy code blocks from latest AI response' },
    { name: 'share',    description: 'Create a session share', args: '[list|show <id>|remove <id>]' },
    { name: 'unshare',  description: 'Remove shares for current session' },
    { name: 'details',  description: 'Toggle tool execution details' },
    { name: 'diff',     description: 'Toggle diff view (file changes)' },
    { name: 'timeline', description: 'Toggle timeline panel', args: '[next|prev|toggle|focus <tool|diff|timeline>]' },
    { name: 'logs',     description: 'Open logs page' },
    { name: 'context',  description: 'Open context picker (files/dirs/symbols)' },
    { name: 'editor',   description: 'Edit message with external editor ($EDITOR)' },
    { name: 'export',   description: 'Export session as Markdown file' },
    { name: 'init',     description: 'Analyze repo and create XQoder.md memory file' },
    { name: 'new',      description: 'Start a new session (clear view)' },
    { name: 'thinking', description: 'Toggle reasoning blocks' },
    { name: 'connect',  description: 'Add provider' },
    { name: 'rollbacks', description: 'Show project rollback points' },
    { name: 'doctor',   description: 'Check config, dependencies, and credentials' },
    { name: 'dir',      description: 'Switch current project directory', args: '<path>' },
    { name: 'agent',    description: 'Set current agent', args: '<general|plan|coder>' },
    { name: 'sandbox',  description: 'Set sandbox mode', args: '<project|paths|full-access>' },
    { name: 'mouse',    description: 'Set mouse mode', args: '<terminal|app>' },
    { name: 'clear',    description: 'Clear messages' },
    { name: 'help',     description: 'Show command help' },
    { name: 'exit',     description: 'Exit TUI' },
    { name: 'quit',     description: 'Same as /exit' },
    { name: 'q',        description: 'Same as /exit' },
];

export function getTuiHelpLines(): string[] {
    return [
        'Type natural language directly to continue chatting.',
        '/chat <message>   Send a chat message explicitly',
        '/sessions         Open session switcher (Ctrl+S)',
        '/sessions show <id> Show session details',
        '/resume [id]      Resume a session',
        '/theme            Open theme selector (Ctrl+T)',
        '/models           Open model selector (Ctrl+O)',
        '/models <name>    Switch to a specific model',
        '/compact          Compact current context to reduce token usage',
        '/undo             Roll back to previous file snapshot',
        '/share            Create a local share for current session',
        '/share list       List local shares',
        '/share show <id>  Show share details',
        '/share remove <id> Remove a local share',
        '/unshare          Remove shares for current session',
        '/copy             Copy latest AI response',
        '/copy-session     Copy full session transcript',
        '/copy-code        Copy code blocks from latest AI response',
        '/details          Toggle tool execution details',
        '/diff             Toggle diff view (file changes)',
        '/timeline         Toggle timeline panel',
        '/timeline next    Move timeline selection down',
        '/timeline prev    Move timeline selection up',
        '/timeline toggle  Expand/collapse selected timeline event',
        '/timeline focus <tool|diff|timeline> Focus a panel and sync selection',
        '/export           Export session as Markdown file',
        '/rollbacks        Show recent rollback points for current project',
        '/doctor           Check config, dependencies, and credentials',
        '/dir <path>       Switch current project directory',
        '/agent <name>     Set current agent (general/plan/coder)',
        '/scope <value>    Set or clear default deploy scope',
        '/sandbox <mode>   Set sandbox mode (project/paths/full-access)',
        '/mouse <mode>     Set mouse mode (terminal/app)',
        '/clear            Clear message list',
        '/help             Show help',
        '/exit             Exit TUI',
    ];
}

function resolveCommandPath(currentDir: string, rawPath: string): string {
    return path.isAbsolute(rawPath)
        ? path.normalize(rawPath)
        : path.resolve(currentDir, rawPath);
}

function parseSandboxModeCommand(value: string): TuiCommand {
    if (value === 'project' || value === 'paths' || value === 'full-access') {
        return { type: 'set_sandbox_mode', sandboxMode: value };
    }

    return {
        type: 'error',
        message: 'Usage: /sandbox <project|paths|full-access>',
    };
}

function parseMouseModeCommand(value: string): TuiCommand {
    if (value === 'terminal' || value === 'app') {
        return { type: 'set_mouse_mode', mouseMode: value };
    }

    return {
        type: 'error',
        message: 'Usage: /mouse <terminal|app>',
    };
}

function parseSessionsCommand(value: string): TuiCommand {
    if (!value) {
        return { type: 'session_action', action: 'list' };
    }

    const tokens = value.split(/\s+/).filter(Boolean);
    if (tokens[0] === 'show' && tokens[1]) {
        return {
            type: 'session_action',
            action: 'show',
            sessionId: tokens[1],
        };
    }

    return {
        type: 'error',
        message: 'Usage: /sessions or /sessions show <sessionId>',
    };
}

function parseShareCommand(value: string): TuiCommand {
    if (!value) {
        return {
            type: 'share_action',
            action: 'create',
        };
    }

    const tokens = value.split(/\s+/).filter(Boolean);
    switch (tokens[0]) {
        case 'create':
            return {
                type: 'share_action',
                action: 'create',
                ...(tokens[1] ? { sessionId: tokens[1] } : {}),
            };
        case 'list':
            return {
                type: 'share_action',
                action: 'list',
            };
        case 'show':
            return tokens[1]
                ? {
                    type: 'share_action',
                    action: 'show',
                    shareId: tokens[1],
                }
                : {
                    type: 'error',
                    message: 'Usage: /share show <shareId>',
                };
        case 'remove':
            return tokens[1]
                ? {
                    type: 'share_action',
                    action: 'remove',
                    shareId: tokens[1],
                }
                : {
                    type: 'error',
                    message: 'Usage: /share remove <shareId>',
                };
        default:
            return {
                type: 'error',
                message: 'Usage: /share [create [sessionId]|list|show <shareId>|remove <shareId>]',
            };
    }
}
