import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCliArgs, getSlashCommands, getTuiHelpLines, parseTuiCommand } from './commands.js';

describe('parseTuiCommand', () => {
    const settings = {
        dir: '/workspace/demo',
        model: 'qwen-plus',
        agent: 'general',
        scope: 'my-team',
        sandboxMode: 'project' as const,
        enabledPlugins: ['cli-core-shell'],
    };

    it('treats plain text as a chat request', () => {
        expect(parseTuiCommand('你好', settings)).toEqual({
            type: 'execute',
            command: 'chat',
            description: '你好',
        });
    });

    it('lets natural language requests go through chat by default', () => {
        expect(parseTuiCommand('vite blog', settings)).toEqual({
            type: 'execute',
            command: 'chat',
            description: 'vite blog',
        });
    });

    it('resolves relative directories from the current project directory', () => {
        expect(parseTuiCommand('/dir ../other-project', settings)).toEqual({
            type: 'set_dir',
            dir: path.resolve('/workspace/demo', '../other-project'),
        });
    });

    it('parses /scope with no value as clearing the scope', () => {
        expect(parseTuiCommand('/scope', settings)).toEqual({
            type: 'set_scope',
            scope: undefined,
        });
    });

    it('parses /sandbox full-access', () => {
        expect(parseTuiCommand('/sandbox full-access', settings)).toEqual({
            type: 'set_sandbox_mode',
            sandboxMode: 'full-access',
        });
    });

    it('parses /agent coder', () => {
        expect(parseTuiCommand('/agent coder', settings)).toEqual({
            type: 'set_agent',
            agent: 'coder',
        });
    });

    it('parses /mouse terminal and /mouse app', () => {
        expect(parseTuiCommand('/mouse terminal', settings)).toEqual({
            type: 'set_mouse_mode',
            mouseMode: 'terminal',
        });
        expect(parseTuiCommand('/mouse app', settings)).toEqual({
            type: 'set_mouse_mode',
            mouseMode: 'app',
        });
    });

    it('parses /sessions and /resume as inline session actions', () => {
        expect(parseTuiCommand('/sessions', settings)).toEqual({
            type: 'open_dialog',
            dialog: 'session',
        });
        expect(parseTuiCommand('/resume', settings)).toEqual({
            type: 'session_action',
            action: 'resume',
        });
        expect(parseTuiCommand('/resume session_123', settings)).toEqual({
            type: 'session_action',
            action: 'resume',
            sessionId: 'session_123',
        });
        expect(parseTuiCommand('/sessions show session_123', settings)).toEqual({
            type: 'session_action',
            action: 'show',
            sessionId: 'session_123',
        });
    });

    it('parses /share actions as inline share operations', () => {
        expect(parseTuiCommand('/share', settings)).toEqual({
            type: 'share_action',
            action: 'create',
        });
        expect(parseTuiCommand('/share list', settings)).toEqual({
            type: 'share_action',
            action: 'list',
        });
        expect(parseTuiCommand('/share show share_123', settings)).toEqual({
            type: 'share_action',
            action: 'show',
            shareId: 'share_123',
        });
        expect(parseTuiCommand('/share remove share_123', settings)).toEqual({
            type: 'share_action',
            action: 'remove',
            shareId: 'share_123',
        });
    });

    it('parses /doctor as an executable config action', () => {
        expect(parseTuiCommand('/doctor', settings)).toEqual({
            type: 'execute',
            command: 'doctor',
        });
    });

    it('blocks /rollbacks unless integrations plugin is enabled', () => {
        expect(parseTuiCommand('/rollbacks', settings)).toEqual({
            type: 'error',
            message: '/rollbacks 属于扩展能力，默认关闭。请在配置 plugins.enabled 中启用 "cli-integrations"。',
        });

        expect(parseTuiCommand('/rollbacks', {
            ...settings,
            enabledPlugins: ['cli-core-shell', 'cli-integrations'],
        })).toEqual({
            type: 'execute',
            command: 'rollbacks',
        });
    });

    it('parses session UX slash commands for copy export details and unshare', () => {
        expect(parseTuiCommand('/copy', settings)).toEqual({
            type: 'copy',
        });
        expect(parseTuiCommand('/copy-session', settings)).toEqual({
            type: 'copy_session',
        });
        expect(parseTuiCommand('/copy-code', settings)).toEqual({
            type: 'copy_code',
        });
        expect(parseTuiCommand('/export', settings)).toEqual({
            type: 'export_md',
        });
        expect(parseTuiCommand('/details', settings)).toEqual({
            type: 'details',
        });
        expect(parseTuiCommand('/diff', settings)).toEqual({
            type: 'diff',
        });
        expect(parseTuiCommand('/timeline', settings)).toEqual({
            type: 'timeline',
        });
        expect(parseTuiCommand('/timeline next', settings)).toEqual({
            type: 'timeline_nav',
            direction: 'next',
        });
        expect(parseTuiCommand('/timeline prev', settings)).toEqual({
            type: 'timeline_nav',
            direction: 'prev',
        });
        expect(parseTuiCommand('/timeline toggle', settings)).toEqual({
            type: 'timeline_nav',
            direction: 'toggle',
        });
        expect(parseTuiCommand('/timeline focus tool', settings)).toEqual({
            type: 'timeline_focus',
            panel: 'tool',
        });
        expect(parseTuiCommand('/timeline focus diff', settings)).toEqual({
            type: 'timeline_focus',
            panel: 'diff',
        });
        expect(parseTuiCommand('/timeline focus timeline', settings)).toEqual({
            type: 'timeline_focus',
            panel: 'timeline',
        });
        expect(parseTuiCommand('/unshare', settings)).toEqual({
            type: 'unshare',
        });
    });

    it('returns an error for unknown slash commands', () => {
        expect(parseTuiCommand('/unknown', settings)).toEqual({
            type: 'error',
            message: 'Unknown command: /unknown',
        });
    });
});

describe('getTuiHelpLines', () => {
    it('includes session UX discoverability lines', () => {
        const help = getTuiHelpLines({ enabledPlugins: ['cli-core-shell'] }).join('\n');
        expect(help).toContain('/copy             Copy latest AI response');
        expect(help).toContain('/copy-session     Copy full session transcript');
        expect(help).toContain('/copy-code        Copy code blocks from latest AI response');
        expect(help).toContain('/details          Toggle tool execution details');
        expect(help).toContain('/diff             Toggle diff view (file changes)');
        expect(help).toContain('/timeline         Toggle timeline panel');
        expect(help).toContain('/timeline next    Move timeline selection down');
        expect(help).toContain('/timeline prev    Move timeline selection up');
        expect(help).toContain('/timeline toggle  Expand/collapse selected timeline event');
        expect(help).toContain('/timeline focus <tool|diff|timeline> Focus a panel and sync selection');
        expect(help).toContain('/export           Export session as Markdown file');
        expect(help).toContain('/unshare          Remove shares for current session');
        expect(help).not.toContain('/rollbacks        Show recent rollback points for current project');
    });

    it('shows integration-only help and slash commands only when enabled', () => {
        const enabledSettings = { enabledPlugins: ['cli-core-shell', 'cli-integrations'] as string[] };

        expect(getTuiHelpLines(enabledSettings).join('\n')).toContain('/rollbacks        Show recent rollback points for current project');
        expect(getSlashCommands({ enabledPlugins: ['cli-core-shell'] }).map((command) => command.name)).not.toContain('rollbacks');
        expect(getSlashCommands(enabledSettings).map((command) => command.name)).toContain('rollbacks');
    });
});

describe('buildCliArgs', () => {
    it('includes model and dir for chat commands', () => {
        expect(buildCliArgs({
            type: 'execute',
            command: 'chat',
            description: '你好',
        }, {
            dir: '/workspace/demo',
            model: 'qwen-plus',
            agent: 'general',
            sandboxMode: 'project',
        })).toEqual([
            'chat',
            '你好',
            '--dir',
            '/workspace/demo',
            '--model',
            'qwen-plus',
            '--agent',
            'general',
        ]);
    });

    it('includes model and dir for build commands', () => {
        expect(buildCliArgs({
            type: 'execute',
            command: 'build',
            description: 'vite blog',
        }, {
            dir: '/workspace/demo',
            model: 'qwen-plus',
            agent: 'coder',
            sandboxMode: 'project',
        })).toEqual([
            'build',
            'vite blog',
            '--dir',
            '/workspace/demo',
            '--model',
            'qwen-plus',
            '--agent',
            'coder',
        ]);
    });

    it('includes deploy scope when present', () => {
        expect(buildCliArgs({
            type: 'execute',
            command: 'deploy',
        }, {
            dir: '/workspace/demo',
            model: 'qwen-plus',
            agent: 'general',
            scope: 'my-team',
            sandboxMode: 'project',
        })).toEqual([
            'deploy',
            '--dir',
            '/workspace/demo',
            '--scope',
            'my-team',
        ]);
    });

    it('includes active session id for chat commands when present', () => {
        expect(buildCliArgs({
            type: 'execute',
            command: 'chat',
            description: '继续',
        }, {
            dir: '/workspace/demo',
            model: 'qwen-plus',
            agent: 'general',
            sandboxMode: 'project',
        }, {
            sessionId: 'session_123',
        })).toEqual([
            'chat',
            '继续',
            '--dir',
            '/workspace/demo',
            '--model',
            'qwen-plus',
            '--agent',
            'general',
            '--session',
            'session_123',
        ]);
    });

    it('builds config doctor args', () => {
        expect(buildCliArgs({
            type: 'execute',
            command: 'doctor',
        }, {
            dir: '/workspace/demo',
            model: 'qwen-plus',
            agent: 'general',
            sandboxMode: 'project',
        })).toEqual([
            'config',
            'doctor',
        ]);
    });
});
