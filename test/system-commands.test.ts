import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { ConfigManager } from '@xqoder/shared';
import {
    createHooksSnapshot,
    runSetDisableAllHooksCommand,
} from '../src/application/system/hooks.js';
import {
    buildAutoProjectContext,
    buildChatPromptAppendix,
    buildChatSystemPrompt,
    maybeAugmentPromptWithProjectContext,
    shouldUseStructuredEngineeringResponse,
} from '../src/application/chat/run-chat.js';
import {
    createMemorySnapshot,
    runInitMemoryCommand,
    runMigrateMemoryCommand,
} from '../src/application/system/memory.js';
import {
    buildProjectNotepadPromptAppendix,
    createNotepadSnapshot,
    createNotepadStats,
    runPruneNotepadCommand,
    runWriteAutoWorkingNotepadCommand,
    runWriteManualNotepadCommand,
    runWritePriorityNotepadCommand,
    runWriteWorkingNotepadCommand,
} from '../src/application/system/notepad.js';
import {
    createPermissionsSnapshot,
    describeSupportedApprovalPolicies,
    describeSupportedPermissionModes,
    formatPermissionsSnapshot,
    runSetApprovalPolicyCommand,
    runSetPermissionsDefaultCommand,
    runPermissionsPathCommand,
    runSetToolPermissionCommand,
    runUnsetToolPermissionCommand,
} from '../src/application/system/permissions.js';
import type { SandboxSettings } from '@xqoder/shared';
import {
    discoverCommandRegistrations,
    getBuiltInCommandRegistrations,
    resolveEnabledPluginNames,
} from '../src/plugins/command-plugins.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('memory command helpers', () => {
    it('creates CLAUDE.md when initializing an empty project', () => {
        const cwd = createTempDir();

        const result = runInitMemoryCommand({ cwd }, { writeOutput: () => {} });
        const content = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf-8');

        expect(result.changed).toBe(true);
        expect(result.claudeExists).toBe(true);
        expect(fs.existsSync(path.join(cwd, 'CLAUDE.md'))).toBe(true);
        expect(content).toContain('- Build: bun run build');
        expect(content).toContain('- Test: bun run test');
        expect(content).toContain('- Lint: bun run lint');
        expect(content).toContain('## Working Principles');
        expect(content).toContain('- Think before coding: state assumptions, expose tradeoffs, and stop when requirements are unclear.');
        expect(content).toContain('- Surgical changes: touch only the files and lines required for the task.');
    });

    it('migrates legacy XQoder.md content into CLAUDE.md', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'XQoder.md'), '# Legacy\n', 'utf-8');

        const result = runMigrateMemoryCommand({ cwd }, { writeOutput: () => {} });
        const snapshot = createMemorySnapshot({ cwd });

        expect(result.changed).toBe(true);
        expect(result.migratedFromLegacy).toBe(true);
        expect(snapshot.content).toBe('# Legacy\n');
    });

    it('treats .claude/CLAUDE.md as an active compatibility path without creating duplicates', () => {
        const cwd = createTempDir();
        const compatPath = path.join(cwd, '.claude', 'CLAUDE.md');
        fs.mkdirSync(path.dirname(compatPath), { recursive: true });
        fs.writeFileSync(compatPath, '# Claude Compat\n', 'utf-8');

        const snapshot = createMemorySnapshot({ cwd });
        const initResult = runInitMemoryCommand({ cwd }, { writeOutput: () => {} });

        expect(snapshot.claudeExists).toBe(false);
        expect(snapshot.claudeCompatExists).toBe(true);
        expect(snapshot.activePath).toBe(compatPath);
        expect(initResult.changed).toBe(false);
        expect(fs.existsSync(path.join(cwd, 'CLAUDE.md'))).toBe(false);
    });
});

describe('chat prompt helpers', () => {
    it('tells the agent to inspect the current project before asking the user for files', () => {
        const sandbox: SandboxSettings = { mode: 'project', allowedPaths: [] };

        const prompt = buildChatSystemPrompt(sandbox, '/tmp/demo-project');

        expect(prompt).toContain('The current project directory is: /tmp/demo-project.');
        expect(prompt).toContain('If the user asks about "this project", "this repo", "the current codebase"');
        expect(prompt).toContain('inspect without modifying files unless the user explicitly asks for changes');
        expect(prompt).toContain('prefer search_code and read_file before considering run_shell');
        expect(prompt).toContain('If read_file reports that the file is too large');
        expect(prompt).toContain('Do not repeatedly search generic phrases');
        expect(prompt).toContain('For single-file analysis, distinguish evidence from inference');
        expect(prompt).toContain('Only ask the user to provide files or paths after you have already tried inspecting the current project');
        expect(prompt).toContain("prefer the user's language");
    });

    it('uses a direct no-tool response prompt for greetings and identity questions', () => {
        const sandbox: SandboxSettings = { mode: 'project', allowedPaths: [] };

        const prompt = buildChatSystemPrompt(sandbox, '/tmp/demo-project', { structuredOutput: false });

        expect(shouldUseStructuredEngineeringResponse('你好 你是谁')).toBe(false);
        expect(shouldUseStructuredEngineeringResponse('你是什么模型')).toBe(false);
        expect(shouldUseStructuredEngineeringResponse('您能干嘛')).toBe(false);
        expect(shouldUseStructuredEngineeringResponse('你可以干嘛')).toBe(false);
        expect(shouldUseStructuredEngineeringResponse('请用中文重新回答我一遍')).toBe(false);
        expect(shouldUseStructuredEngineeringResponse('解释这个项目')).toBe(false);
        expect(shouldUseStructuredEngineeringResponse('/Users/wangxinglin/Downloads/code.html 帮我分析一下这个项目')).toBe(false);
        expect(shouldUseStructuredEngineeringResponse('为什么 doctor 说 API key 缺失')).toBe(false);
        expect(shouldUseStructuredEngineeringResponse('按文档的需求继续推进')).toBe(true);
        expect(shouldUseStructuredEngineeringResponse('你好，帮我修 src/utils.ts 的 bug')).toBe(true);
        expect(prompt).not.toContain('USER_PROMPT');
        expect(prompt).not.toContain('EXECUTION_LOG');
        expect(prompt).toContain('Do not claim that you read files, searched code, ran commands, inspected git diff, or inspected project context unless a tool was actually executed');
        expect(prompt).toContain('For greetings, identity questions, small talk, or clarification questions, answer directly');
        expect(prompt).toContain('For capability questions, keep the answer short and natural');
    });

    it('includes truthful runtime model identity when provided', () => {
        const sandbox: SandboxSettings = { mode: 'project', allowedPaths: [] };

        const prompt = buildChatSystemPrompt(sandbox, '/tmp/demo-project', {
            structuredOutput: false,
            runtimeIdentity: {
                provider: 'dashscope',
                model: 'qwen-plus',
            },
        });

        expect(prompt).toContain('configured LLM provider/model: dashscope/qwen-plus');
        expect(prompt).toContain('我是 XQoder；当前连接的模型是 dashscope/qwen-plus.');
        expect(prompt).toContain('Do not answer as if XQoder itself were the model');
        expect(prompt).toContain('do not say you are not a language model');
        expect(prompt).toContain('Do not mention project-specific files, scripts, configs, dependencies, recent diffs, or implementation details unless the user provided them');
        expect(prompt).toContain('This overrides generic default-agent English preferences');
    });

    it('keeps capability prompts free from model-identity instructions', () => {
        const sandbox: SandboxSettings = { mode: 'project', allowedPaths: [] };

        const prompt = buildChatPromptAppendix('你可以干嘛', sandbox, '/tmp/demo-project', {
            provider: 'dashscope',
            model: 'qwen-plus',
        });

        expect(prompt).not.toContain('configured LLM provider/model: dashscope/qwen-plus');
        expect(prompt).toContain('The current user message is a capability question');
        expect(prompt).toContain('Do not mention the current model/provider unless the user explicitly asked about the model');
        expect(prompt).toContain('Reply in 1-3 short sentences');
        expect(prompt).toContain('Use natural wording; do not force a single fixed template sentence');
    });

    it('injects current project context for project-explanation prompts', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'README.md'), '# Demo Project\n\nA sample app.\n', 'utf-8');
        fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
            name: 'demo-project',
            description: 'Sample terminal app',
            scripts: {
                build: 'bun run build',
                test: 'bun test',
            },
        }, null, 2));

        const augmented = maybeAugmentPromptWithProjectContext('用中文解释这个项目是干什么的', cwd);
        const context = buildAutoProjectContext(cwd);

        expect(context).toContain('Project root:');
        expect(context).toContain('README.md snippet:');
        expect(context).toContain('package.json summary:');
        expect(augmented).toContain('[AutoProjectContext]');
        expect(augmented).toContain('demo-project');
        expect(augmented).toContain('A sample app.');
    });

    it('does not inject project context for unrelated prompts', () => {
        const cwd = createTempDir();

        const augmented = maybeAugmentPromptWithProjectContext('只回复 TEST_OK', cwd);

        expect(augmented).toBe('只回复 TEST_OK');
    });
});

describe('notepad command helpers', () => {
    it('writes project notepad sections and exposes prompt appendix context', () => {
        const cwd = createTempDir();

        runWritePriorityNotepadCommand('Project uses Bun and strict TypeScript.', { cwd }, { writeOutput: () => {} });
        runWriteWorkingNotepadCommand('Investigating chat session port migration.', { cwd }, { writeOutput: () => {} });
        runWriteManualNotepadCommand('Deploy owner: platform@example.com', { cwd }, { writeOutput: () => {} });

        const snapshot = createNotepadSnapshot({ cwd });
        const appendix = buildProjectNotepadPromptAppendix(cwd);

        expect(snapshot.exists).toBe(true);
        expect(snapshot.sections.priority).toContain('Project uses Bun');
        expect(snapshot.workingEntries).toHaveLength(1);
        expect(snapshot.manualEntries).toContain('Deploy owner: platform@example.com');
        expect(appendix).toContain('Project priority context:');
        expect(appendix).toContain('Recent working notes:');
    });

    it('prunes stale working-memory entries while keeping recent ones', () => {
        const cwd = createTempDir();
        const notepadPath = path.join(cwd, '.xqoder', 'notepad.md');

        fs.mkdirSync(path.dirname(notepadPath), { recursive: true });
        fs.writeFileSync(notepadPath, [
            '## PRIORITY',
            'Keep this.',
            '',
            '## WORKING MEMORY',
            '[2000-01-01T00:00:00.000Z] stale entry',
            `[${new Date().toISOString()}] fresh entry`,
            '',
            '## MANUAL',
            'manual entry',
            '',
        ].join('\n'), 'utf-8');

        const result = runPruneNotepadCommand({ cwd, daysOld: 7 }, { writeOutput: () => {} });
        const stats = createNotepadStats({ cwd });

        expect(result.pruned).toBe(1);
        expect(result.workingEntries).toHaveLength(1);
        expect(result.workingEntries[0]).toContain('fresh entry');
        expect(stats.workingEntryCount).toBe(1);
    });

    it('writes automatic working-memory summaries without duplicating the latest entry', () => {
        const cwd = createTempDir();

        const first = runWriteAutoWorkingNotepadCommand({
            prompt: 'Fix the HTTP approval bridge so remote sessions can resume after approvals.',
            response: 'Implemented remote approval resolution, added tests, and verified the HTTP stream path.',
        }, { cwd }, { writeOutput: () => {} });
        const second = runWriteAutoWorkingNotepadCommand({
            prompt: 'Fix the HTTP approval bridge so remote sessions can resume after approvals.',
            response: 'Implemented remote approval resolution, added tests, and verified the HTTP stream path.',
        }, { cwd }, { writeOutput: () => {} });

        expect(first.changed).toBe(true);
        expect(second.changed).toBe(false);
        expect(first.workingEntries).toHaveLength(1);
        expect(first.workingEntries[0]).toContain('Task: Fix the HTTP approval bridge');
        expect(first.workingEntries[0]).toContain('Outcome: Implemented remote approval resolution');
    });
});

describe('permissions command helpers', () => {
    it('sets and unsets tool overrides in the writable config file', () => {
        const homeDir = createTempDir();
        const configPath = path.join(homeDir, '.xqoder', 'config.json');
        const manager = new ConfigManager({ configPath, homeDir });

        manager.load({ mode: 'single' });
        runSetPermissionsDefaultCommand('allow', {}, { writeOutput: () => {} }, manager);
        runSetApprovalPolicyCommand('workspace_auto', {}, { writeOutput: () => {} }, manager);
        runSetToolPermissionCommand('bash', 'deny', {}, { writeOutput: () => {} }, manager);

        let snapshot = createPermissionsSnapshot({}, manager);
        expect(snapshot.permissions.approvalPolicy).toBe('workspace_auto');
        expect(snapshot.permissions.defaultMode).toBe('allow');
        expect(snapshot.permissions.tools['bash']).toBe('deny');

        runUnsetToolPermissionCommand('bash', {}, { writeOutput: () => {} }, manager);
        snapshot = createPermissionsSnapshot({}, manager);
        expect(snapshot.permissions.tools['bash']).toBeUndefined();
    });

    it('resolves a project-scoped permission config path', () => {
        const cwd = createTempDir();

        const permissionPath = runPermissionsPathCommand({ cwd, scope: 'project' }, { writeOutput: () => {} });

        expect(permissionPath).toBe(path.join(cwd, '.xqoder', 'config.json'));
    });
});

describe('hooks command helpers', () => {
    it('toggles disableAllHooks in the writable config file', () => {
        const homeDir = createTempDir();
        const configPath = path.join(homeDir, '.xqoder', 'config.json');
        const manager = new ConfigManager({ configPath, homeDir });

        manager.load({ mode: 'single' });
        runSetDisableAllHooksCommand(true, {}, { writeOutput: () => {} }, manager);

        let snapshot = createHooksSnapshot({}, manager);
        expect(snapshot.disableAllHooks).toBe(true);

        runSetDisableAllHooksCommand(false, {}, { writeOutput: () => {} }, manager);
        snapshot = createHooksSnapshot({}, manager);
        expect(snapshot.disableAllHooks).toBe(false);
    });

    it('ignores unsupported hook events from config files', () => {
        const homeDir = createTempDir();
        const configPath = path.join(homeDir, '.xqoder', 'config.json');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({
            hooks: {
                UnsupportedEvent: [
                    {
                        hooks: [{ type: 'command', command: 'echo blocked' }],
                    },
                ],
                PreToolUse: [
                    {
                        hooks: [{ type: 'command', command: 'echo allowed' }],
                    },
                ],
            },
        }, null, 2));

        const snapshot = createHooksSnapshot({}, new ConfigManager({ configPath, homeDir }));

        expect(snapshot.events.map((event) => event.event)).toEqual(['PreToolUse']);
        expect(snapshot.entries.every((entry) => entry.event === 'PreToolUse')).toBe(true);
    });

    it('omits undefined optional hook fields while preserving explicit false values', () => {
        const homeDir = createTempDir();
        const configPath = path.join(homeDir, '.xqoder', 'config.json');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({
            hooks: {
                PreToolUse: [
                    {
                        hooks: [{ type: 'command', command: 'echo allowed', async: false }],
                    },
                ],
            },
        }, null, 2));

        const snapshot = createHooksSnapshot({}, new ConfigManager({ configPath, homeDir }));
        const entry = snapshot.entries[0];

        expect(entry.async).toBe(false);
        expect('matcher' in entry).toBe(false);
        expect('timeout' in entry).toBe(false);
        expect('disableAllHooks' in snapshot.sources[0]).toBe(false);
    });
});

describe('permissions snapshot helpers', () => {
    it('omits undefined optional source fields', () => {
        const homeDir = createTempDir();
        const configPath = path.join(homeDir, '.xqoder', 'config.json');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({
            permissions: {
                tools: {
                    bash: 'deny',
                },
            },
        }, null, 2));

        const snapshot = createPermissionsSnapshot({}, new ConfigManager({ configPath, homeDir }));
        const source = snapshot.sources[0];

        expect(snapshot.permissions.approvalPolicy).toBe('strict');
        expect(source.tools['bash']).toBe('deny');
        expect('defaultMode' in source).toBe(false);
        expect('approvalPolicy' in source).toBe(false);
        expect('sandboxMode' in source).toBe(false);
    });

    it('formats a baseline summary that explains effective permission behavior', () => {
        const snapshot = {
            cwd: '/tmp/project',
            sandboxMode: 'project',
            permissions: {
                defaultMode: 'auto',
                tools: { edit: 'allow' },
                allowedTools: [],
                disallowedTools: [],
                approvalPolicy: 'workspace_auto',
            },
            sources: [],
            rules: [],
        } as const;

        const output = formatPermissionsSnapshot(snapshot);
        expect(output).toContain('summary:');
        expect(output).toContain('Reads inside the workspace are treated as routine');
        expect(output).toContain('Sensitive local files and protected config paths still require approval');
        expect(output).toContain('baseline:');
        expect(output).toContain('workspace reads: auto-allow');
        expect(output).toContain('outside-workspace reads: ask');
        expect(output).toContain('workspace writes: allow after read when target is ordinary');
        expect(output).toContain('internal runtime paths: allow by scope');
        expect(output).toContain('notes:');
        expect(output).toContain('workspace_auto relaxes ordinary in-workspace writes');
        expect(output).toContain('prefer an explicit rule or allowed path entry');
    });

    it('exposes all supported permission modes and approval policies for CLI help', () => {
        expect(describeSupportedPermissionModes()).toBe('allow | ask | deny | auto | plan | default | bypassPermissions | acceptEdits');
        expect(describeSupportedApprovalPolicies()).toBe('strict | balanced | workspace_auto');
    });
});

describe('command plugin defaults', () => {
    it('enables workflow and extras plugins by default', () => {
        const enabled = resolveEnabledPluginNames();

        expect(enabled.has('cli-core-shell')).toBe(true);
        expect(enabled.has('cli-system')).toBe(true);
        expect(enabled.has('cli-workflows')).toBe(true);
        expect(enabled.has('cli-extras')).toBe(true);
    });

    it('exposes workflow/extras commands while keeping removed legacy surfaces disabled', () => {
        const registrations = getBuiltInCommandRegistrations();
        const names = new Set(registrations.map((registration) => registration.name));

        expect(names.has('chat')).toBe(true);
        expect(names.has('tui')).toBe(true);
        expect(names.has('build')).toBe(true);
        expect(names.has('fix')).toBe(true);
        expect(names.has('run')).toBe(true);
        expect(names.has('start')).toBe(true);
        expect(names.has('test')).toBe(true);
        expect(names.has('deploy')).toBe(true);
        expect(names.has('plan')).toBe(true);
        expect(names.has('review')).toBe(true);
        expect(names.has('automation')).toBe(true);
        expect(names.has('explain')).toBe(true);
        expect(names.has('github')).toBe(true);
        expect(names.has('agents')).toBe(true);
        expect(names.has('mcp')).toBe(true);
        expect(names.has('serve')).toBe(true);
        expect(names.has('attach')).toBe(false);
        expect(names.has('acp')).toBe(false);
        expect(names.has('hooks')).toBe(true);
        expect(names.has('memory')).toBe(true);
        expect(names.has('notepad')).toBe(false);
    });

    it('keeps legacy cli-remote plugin configs limited to the serve command', async () => {
        const registrations = await discoverCommandRegistrations({
            cwd: process.cwd(),
            pluginConfig: {
                enabled: ['cli-core-shell', 'cli-remote', 'cli-workflows'],
                disabled: [],
                paths: [],
            },
            productName: 'xqoder',
            productVersion: '0.1.0',
        });
        const names = new Set(registrations.map((registration) => registration.name));

        expect(names.has('serve')).toBe(true);
        expect(names.has('attach')).toBe(false);
        expect(names.has('acp')).toBe(false);
        expect(names.has('hooks')).toBe(false);
    });
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-test-'));
    tempDirs.push(dir);
    return dir;
}
