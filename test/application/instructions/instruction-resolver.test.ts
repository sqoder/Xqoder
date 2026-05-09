import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import type { XQoderConfig } from '@xqoder/shared';
import {
    resolveAgentInstructionAppendix,
    resolveInstructionAppendix,
    resolveInstructionSet,
} from '../../../src/application/instructions/index.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('instruction resolver', () => {
    it('does not inject project rules when no local rule file exists', () => {
        const cwd = createTempDir();

        const resolved = resolveInstructionSet({
            cwd,
            projectConfigInstructions: ['project-config'],
            userConfigInstructions: ['user-config'],
        });

        expect(resolved.sources.map((source) => source.name)).toEqual([
            'project_config',
            'user_config',
        ]);
        expect(resolved.orderedInstructions).toEqual([
            'project-config',
            'user-config',
        ]);
    });

    it('loads project rule files when xqoder.md is present', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'xqoder.md'), [
            '# Local rules',
            'Use Bun first.',
            'Keep answers concise.',
        ].join('\n'), 'utf-8');

        const resolved = resolveInstructionSet({ cwd });

        expect(resolved.sources.map((source) => source.name)).toEqual(['project_rules']);
        expect(resolved.sources[0]?.entries[0]).toContain('xqoder.md:');
        expect(resolved.sources[0]?.entries[0]).toContain('Use Bun first.');
    });

    it('loads Claude-compatible rule files from .claude/CLAUDE.md and .claude/rules', () => {
        const cwd = createTempDir();
        const claudeDir = path.join(cwd, '.claude');
        fs.mkdirSync(path.join(claudeDir, 'rules'), { recursive: true });
        fs.writeFileSync(path.join(claudeDir, 'CLAUDE.md'), 'Project Claude instructions.', 'utf-8');
        fs.writeFileSync(path.join(claudeDir, 'rules', 'typescript.md'), 'Prefer exact optional property types.', 'utf-8');

        const resolved = resolveInstructionSet({ cwd });
        const projectRules = resolved.sources.find((source) => source.name === 'project_rules');
        const combined = projectRules?.entries.join('\n') ?? '';

        expect(combined).toContain('.claude/CLAUDE.md:');
        expect(combined).toContain('Project Claude instructions.');
        expect(combined).toContain('.claude/rules/typescript.md:');
        expect(combined).toContain('Prefer exact optional property types.');
    });

    it('injects priority, working memory, and manual notes from the project notepad', () => {
        const cwd = createTempDir();
        writeNotepad(cwd, [
            '## PRIORITY',
            'Ship provider bootstrap first.',
            '',
            '## WORKING MEMORY',
            '[2026-04-22T06:00:00.000Z] Investigating stream-json parity.',
            '[2026-04-22T06:05:00.000Z] Keep transport thin.',
            '',
            '## MANUAL',
            'Deploy owner: platform@example.com',
            '',
        ].join('\n'));

        const resolved = resolveInstructionSet({ cwd });
        const workingMemory = resolved.sources.find((source) => source.name === 'working_memory');

        expect(workingMemory?.entries).toEqual([
            'Priority:\nShip provider bootstrap first.',
            'Latest working memory:\n[2026-04-22T06:00:00.000Z] Investigating stream-json parity.\n[2026-04-22T06:05:00.000Z] Keep transport thin.',
            'Manual notes:\nDeploy owner: platform@example.com',
        ]);
    });

    it('does not materialize empty notepad sections as working-memory instructions', () => {
        const cwd = createTempDir();
        writeNotepad(cwd, [
            '## PRIORITY',
            '',
            '## WORKING MEMORY',
            '',
            '## MANUAL',
            '',
        ].join('\n'));

        const resolved = resolveInstructionSet({ cwd });
        const workingMemory = resolved.sources.find((source) => source.name === 'working_memory');

        expect(workingMemory?.entries ?? []).toEqual([]);
        expect(resolved.orderedInstructions.some((entry) => entry.includes('Latest working memory'))).toBe(false);
        expect(resolved.orderedInstructions.some((entry) => entry.includes('Manual notes'))).toBe(false);
    });

    it('keeps duplicated manual notes collapsed to a single ordered instruction', () => {
        const cwd = createTempDir();
        writeNotepad(cwd, [
            '## PRIORITY',
            '',
            '## WORKING MEMORY',
            '',
            '## MANUAL',
            'Deploy owner: platform@example.com',
            '',
        ].join('\n'));

        const resolved = resolveInstructionSet({
            cwd,
            userConfigInstructions: ['Manual notes:\nDeploy owner: platform@example.com'],
        });

        expect(resolved.orderedInstructions.filter((entry) => entry.includes('Deploy owner: platform@example.com'))).toHaveLength(1);
    });

    it('respects source precedence and de-duplicates repeated instructions', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'xqoder.md'), 'Prefer local project rules.', 'utf-8');
        writeNotepad(cwd, [
            '## PRIORITY',
            'Use working memory as the last-resort instruction source.',
            '',
            '## WORKING MEMORY',
            '[2026-04-22T06:00:00.000Z] Recent note.',
            '',
            '## MANUAL',
            '',
        ].join('\n'));

        const resolved = resolveInstructionSet({
            cwd,
            runtimeOverrides: ['shared-rule', 'runtime-only'],
            projectConfigInstructions: ['shared-rule', 'project-only'],
            userConfigInstructions: ['shared-rule', 'user-only'],
        });
        const appendix = resolveInstructionAppendix({
            cwd,
            runtimeOverrides: ['shared-rule', 'runtime-only'],
            projectConfigInstructions: ['shared-rule', 'project-only'],
            userConfigInstructions: ['shared-rule', 'user-only'],
        });

        expect(resolved.orderedInstructions.slice(0, 4)).toEqual([
            'shared-rule',
            'runtime-only',
            'project-only',
            'xqoder.md:\nPrefer local project rules.',
        ]);
        expect(resolved.orderedInstructions).toContain('user-only');
        expect(resolved.orderedInstructions.at(-1)).toContain('Latest working memory');
        expect(appendix).toContain('Runtime overrides:');
        expect((appendix ?? '').indexOf('Runtime overrides:')).toBeLessThan((appendix ?? '').indexOf('Project config:'));
        expect((appendix ?? '').indexOf('Project config:')).toBeLessThan((appendix ?? '').indexOf('Project rule files:'));
        expect((appendix ?? '').indexOf('Project rule files:')).toBeLessThan((appendix ?? '').indexOf('User config:'));
        expect((appendix ?? '').indexOf('User config:')).toBeLessThan((appendix ?? '').indexOf('Working memory / notepad:'));
    });

    it('builds an agent-scoped instruction appendix from config defaults', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'xqoder.md'), 'Honor project-local rules.', 'utf-8');

        const appendix = resolveAgentInstructionAppendix({
            config: createConfig({
                defaultAgent: 'planner',
                instructions: ['reply in Chinese'],
                agents: {
                    planner: {
                        mode: 'primary',
                        provider: 'openai',
                        model: 'gpt-4.1',
                        instructions: ['plan before coding'],
                    },
                },
            }),
            cwd,
            runtimeOverrides: ['user explicitly requested a narrow diff'],
        });

        expect(appendix).toContain('Runtime overrides:');
        expect(appendix).toContain('- user explicitly requested a narrow diff');
        expect(appendix).toContain('Project config:');
        expect(appendix).toContain('- plan before coding');
        expect(appendix).toContain('Project rule files:');
        expect(appendix).toContain('Honor project-local rules.');
        expect(appendix).toContain('User config:');
        expect(appendix).toContain('- reply in Chinese');
    });
});

function createConfig(overrides: Partial<XQoderConfig> = {}): XQoderConfig {
    return {
        llm: {
            provider: 'openai',
            model: 'gpt-4.1',
            apiKey: 'test-key',
        },
        providers: {
            openai: {
                apiKey: 'test-key',
                defaultModel: 'gpt-4.1',
            },
        },
        defaultAgent: 'general',
        agents: {
            general: {
                mode: 'primary',
                provider: 'openai',
                model: 'gpt-4.1',
            },
        },
        sandbox: {
            mode: 'project',
            allowedPaths: [],
        },
        ...overrides,
    };
}

function writeNotepad(cwd: string, content: string): void {
    const notepadPath = path.join(cwd, '.xqoder', 'notepad.md');
    fs.mkdirSync(path.dirname(notepadPath), { recursive: true });
    fs.writeFileSync(notepadPath, content, 'utf-8');
}

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-instruction-resolver-'));
    tempDirs.push(dir);
    return dir;
}
