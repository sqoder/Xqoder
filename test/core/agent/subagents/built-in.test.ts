import { describe, expect, it } from 'bun:test';
import {
    BUILT_IN_AGENTS,
    filterToolsForAgent,
    getBuiltInAgent,
    listBuiltInAgents,
} from '../../../../src/core/agent/subagents/built-in.js';

describe('BUILT_IN_AGENTS (P16a)', () => {
    it('exposes the five canonical subagents', () => {
        const names = listBuiltInAgents().map((a) => a.name).sort();
        expect(names).toEqual(['claude-code-guide', 'explore', 'general-purpose', 'plan', 'verification']);
    });

    it('marks read-only agents as concurrencySafe', () => {
        expect(BUILT_IN_AGENTS['explore']?.concurrencySafe).toBe(true);
        expect(BUILT_IN_AGENTS['plan']?.concurrencySafe).toBe(true);
        expect(BUILT_IN_AGENTS['claude-code-guide']?.concurrencySafe).toBe(true);
    });

    it('marks write/shell agents as not concurrencySafe', () => {
        expect(BUILT_IN_AGENTS['general-purpose']?.concurrencySafe).toBe(false);
        expect(BUILT_IN_AGENTS['verification']?.concurrencySafe).toBe(false);
    });

    it('gives general-purpose the wildcard tool list', () => {
        expect(BUILT_IN_AGENTS['general-purpose']?.allowedTools).toEqual(['*']);
    });

    it('each agent has a non-empty system prompt and description', () => {
        for (const agent of listBuiltInAgents()) {
            expect(agent.systemPrompt.length).toBeGreaterThan(20);
            expect(agent.description.length).toBeGreaterThan(5);
        }
    });

    it('registry is frozen so mutating entries throws in strict mode', () => {
        expect(Object.isFrozen(BUILT_IN_AGENTS)).toBe(true);
    });
});

describe('getBuiltInAgent (P16a)', () => {
    it('returns undefined for unknown names', () => {
        expect(getBuiltInAgent('not-an-agent')).toBeUndefined();
    });
    it('returns the matching entry', () => {
        expect(getBuiltInAgent('explore')?.name).toBe('explore');
    });
});

describe('filterToolsForAgent (P16a)', () => {
    const pool = ['read_file', 'write_file', 'grep_content', 'glob_files', 'list_files', 'run_shell', 'lsp_hover', 'lsp_references'];

    it('filters by exact match', () => {
        const filtered = filterToolsForAgent(pool, BUILT_IN_AGENTS['plan']!);
        expect(filtered.sort()).toEqual(['glob_files', 'grep_content', 'list_files', 'read_file']);
    });

    it('supports trailing-star prefix patterns', () => {
        const filtered = filterToolsForAgent(pool, BUILT_IN_AGENTS['explore']!);
        expect(filtered.sort()).toEqual(['glob_files', 'grep_content', 'list_files', 'lsp_hover', 'lsp_references', 'read_file']);
    });

    it('returns every tool when allowedTools is [\'*\']', () => {
        const filtered = filterToolsForAgent(pool, BUILT_IN_AGENTS['general-purpose']!);
        expect(filtered.length).toBe(pool.length);
    });

    it('keeps verification limited to read_file + run_shell', () => {
        const filtered = filterToolsForAgent(pool, BUILT_IN_AGENTS['verification']!);
        expect(filtered.sort()).toEqual(['read_file', 'run_shell']);
    });
});
