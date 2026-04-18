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
    buildChatSystemPrompt,
    maybeAugmentPromptWithProjectContext,
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
    runWriteManualNotepadCommand,
    runWritePriorityNotepadCommand,
    runWriteWorkingNotepadCommand,
} from '../src/application/system/notepad.js';
import { createIdeSnapshot } from '../src/application/system/ide.js';
import {
    createPermissionsSnapshot,
    runSetPermissionsDefaultCommand,
    runPermissionsPathCommand,
    runSetToolPermissionCommand,
    runUnsetToolPermissionCommand,
} from '../src/application/system/permissions.js';
import type { SandboxSettings } from '@xqoder/shared';
import { resolveEnabledPluginNames } from '../src/plugins/command-plugins.js';

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
});

describe('chat prompt helpers', () => {
    it('tells the agent to inspect the current project before asking the user for files', () => {
        const sandbox: SandboxSettings = { mode: 'project', allowedPaths: [] };

        const prompt = buildChatSystemPrompt(sandbox, '/tmp/demo-project');

        expect(prompt).toContain('The current project directory is: /tmp/demo-project.');
        expect(prompt).toContain('If the user asks about "this project", "this repo", "the current codebase"');
        expect(prompt).toContain('Only ask the user to provide files or paths after you have already tried inspecting the current project');
        expect(prompt).toContain("prefer the user's language");
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
});

describe('permissions command helpers', () => {
    it('sets and unsets tool overrides in the writable config file', () => {
        const homeDir = createTempDir();
        const configPath = path.join(homeDir, '.xqoder', 'config.json');
        const manager = new ConfigManager({ configPath, homeDir });

        manager.load({ mode: 'single' });
        runSetPermissionsDefaultCommand('allow', {}, { writeOutput: () => {} }, manager);
        runSetToolPermissionCommand('bash', 'deny', {}, { writeOutput: () => {} }, manager);

        let snapshot = createPermissionsSnapshot({}, manager);
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

        expect(source.tools['bash']).toBe('deny');
        expect('defaultMode' in source).toBe(false);
        expect('sandboxMode' in source).toBe(false);
    });
});

describe('command plugin defaults', () => {
    it('enables integrations and system commands by default', () => {
        const enabled = resolveEnabledPluginNames();

        expect(enabled.has('cli-core-shell')).toBe(true);
        expect(enabled.has('cli-integrations')).toBe(true);
        expect(enabled.has('cli-system')).toBe(true);
        expect(enabled.has('cli-workflows')).toBe(false);
    });
});

describe('ide command helpers', () => {
    it('builds local attach instructions for the current project', () => {
        const cwd = createTempDir();

        const snapshot = createIdeSnapshot({ cwd });

        expect(snapshot.cwd).toBe(cwd);
        expect(snapshot.bridgeStatus).toBe('not-configured');
        expect(snapshot.serverUrl).toBe('http://127.0.0.1:4096');
        expect(snapshot.serveCommand).toContain(`xqoder serve --dir ${cwd}`);
        expect(snapshot.attachCommand).toContain(`xqoder attach http://127.0.0.1:4096 --dir ${cwd}`);
        expect(snapshot.acpCommand).toContain(`xqoder acp --cwd ${cwd}`);
    });
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-test-'));
    tempDirs.push(dir);
    return dir;
}
