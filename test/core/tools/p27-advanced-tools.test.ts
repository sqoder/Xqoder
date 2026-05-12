// P27b — Advanced tools unit tests.

import { describe, expect, it } from 'bun:test';
import {
    MonitorTool,
    ToolSearchTool,
    WorkflowTool,
    REPLTool,
    SuggestBackgroundPRTool,
} from '../../../src/core/agent/tools/p27-advanced-tools.js';
import type { ToolContext } from '../../../src/core/agent/tools/tool.js';

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
    return { cwd: '/tmp', projectRoot: '/tmp', ...overrides };
}

// ---------------------------------------------------------------------------
// MonitorTool
// ---------------------------------------------------------------------------

describe('MonitorTool', () => {
    it('returns session metrics JSON', async () => {
        const tool = new MonitorTool();
        const result = await tool.execute({ metric: 'all' }, ctx({ sessionId: 'sess-1' }));
        expect(result.success).toBe(true);
        const parsed = JSON.parse(result.output);
        expect(parsed.sessionId).toBe('sess-1');
        expect(parsed.metric).toBe('all');
    });

    it('defaults metric to all', async () => {
        const tool = new MonitorTool();
        const result = await tool.execute({}, ctx());
        expect(result.success).toBe(true);
        const parsed = JSON.parse(result.output);
        expect(parsed.metric).toBe('all');
    });

    it('isConcurrencySafe returns true', () => {
        expect(new MonitorTool().isConcurrencySafe()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// ToolSearchTool
// ---------------------------------------------------------------------------

describe('ToolSearchTool', () => {
    const summaries = [
        { name: 'read_file', description: 'Read a file from the filesystem' },
        { name: 'write_file', description: 'Write content to a file' },
        { name: 'run_shell', description: 'Execute a shell command' },
        { name: 'web_search', description: 'Search the web for information' },
        { name: 'sleep', description: 'Pause execution for milliseconds' },
    ];

    it('returns matching tools for a query', async () => {
        const tool = new ToolSearchTool(summaries);
        const result = await tool.execute({ query: 'file' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('read_file');
        expect(result.output).toContain('write_file');
    });

    it('returns no results for unmatched query', async () => {
        const tool = new ToolSearchTool(summaries);
        const result = await tool.execute({ query: 'xyzzy_nonexistent' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('No tools found');
    });

    it('rejects empty query', async () => {
        const tool = new ToolSearchTool(summaries);
        const result = await tool.execute({ query: '' });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/query is required/);
    });

    it('caps results at 8', async () => {
        const many = Array.from({ length: 20 }, (_, i) => ({
            name: `tool_${i}`,
            description: 'generic tool for testing',
        }));
        const tool = new ToolSearchTool(many);
        const result = await tool.execute({ query: 'generic' });
        expect(result.success).toBe(true);
        const metadata = result.metadata as { results: unknown[] };
        expect(metadata.results.length).toBeLessThanOrEqual(8);
    });
});

// ---------------------------------------------------------------------------
// WorkflowTool
// ---------------------------------------------------------------------------

describe('WorkflowTool', () => {
    it('runs a successful workflow', async () => {
        const tool = new WorkflowTool();
        const result = await tool.execute({
            steps: [
                { name: 'echo hello', command: 'echo hello' },
                { name: 'echo world', command: 'echo world' },
            ],
        }, ctx());
        expect(result.success).toBe(true);
        expect(result.output).toContain('2/2 steps passed');
    });

    it('stops on first failure by default', async () => {
        const tool = new WorkflowTool();
        const result = await tool.execute({
            steps: [
                { name: 'fail', command: 'exit 1' },
                { name: 'should not run', command: 'echo ok' },
            ],
        }, ctx());
        expect(result.success).toBe(false);
        const metadata = result.metadata as { results: Array<{ name: string }> };
        expect(metadata.results).toHaveLength(1);
    });

    it('continues on error when continueOnError is set', async () => {
        const tool = new WorkflowTool();
        const result = await tool.execute({
            steps: [
                { name: 'fail', command: 'exit 1', continueOnError: true },
                { name: 'pass', command: 'echo ok' },
            ],
        }, ctx());
        const metadata = result.metadata as { results: Array<{ name: string }> };
        expect(metadata.results).toHaveLength(2);
    });

    it('rejects empty steps', async () => {
        const tool = new WorkflowTool();
        const result = await tool.execute({ steps: [] }, ctx());
        expect(result.success).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// REPLTool
// ---------------------------------------------------------------------------

describe('REPLTool', () => {
    it('evaluates a simple expression', async () => {
        const tool = new REPLTool();
        const result = await tool.execute({ code: '1 + 2' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('3');
    });

    it('captures console.log output', async () => {
        const tool = new REPLTool();
        const result = await tool.execute({ code: 'console.log("hello world")' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('hello world');
    });

    it('returns error for invalid code', async () => {
        const tool = new REPLTool();
        const result = await tool.execute({ code: 'throw new Error("oops")' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('oops');
    });

    it('rejects empty code', async () => {
        const tool = new REPLTool();
        const result = await tool.execute({ code: '   ' });
        expect(result.success).toBe(false);
    });

    it('isConcurrencySafe returns false', () => {
        expect(new REPLTool().isConcurrencySafe()).toBe(false);
    });
});
