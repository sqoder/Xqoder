import { describe, expect, it } from 'bun:test';
import { BUILT_IN_AGENTS } from '../../../../src/core/agent/subagents/built-in.js';
import {
    assertToolsAllowed,
    buildSubagentSystemPrompt,
    findFinalAssistantContent,
    forkSubagent,
    type ForkSpec,
    type ForkableChildSession,
} from '../../../../src/core/agent/subagents/fork.js';

function makeStubChild(): ForkableChildSession & {
    system?: string;
    messages: Array<{ role: string; content: string }>;
    hydrated?: string[];
} {
    const child = {
        messages: [] as Array<{ role: string; content: string }>,
        hydrated: undefined as string[] | undefined,
        system: undefined as string | undefined,
        getMessages() { return this.messages as unknown as ReturnType<ForkableChildSession['getMessages']>; },
        getUsage() { return { promptTokens: 1, completionTokens: 2, totalTokens: 3 }; },
        getReadFiles() { return this.hydrated ?? []; },
        setSystemPrompt(s: string) { this.system = s; },
        addUserMessage(c: string) { this.messages.push({ role: 'user', content: c }); },
        hydrateReadFiles(files: readonly string[]) { this.hydrated = [...files]; },
    };
    return child as unknown as ForkableChildSession & {
        system?: string; messages: Array<{ role: string; content: string }>; hydrated?: string[];
    };
}

describe('buildSubagentSystemPrompt (P16b)', () => {
    it('prepends subagent prompt and appends parent context + extraSystem', () => {
        const spec: ForkSpec = {
            agent: BUILT_IN_AGENTS['explore']!,
            task: 'investigate',
            extraSystem: 'keep it short',
            toolNames: ['read_file'],
        };
        const prompt = buildSubagentSystemPrompt(
            { baseSystemPrompt: 'Parent project rules', readFiles: [] },
            spec,
        );
        const explore = BUILT_IN_AGENTS['explore']!.systemPrompt;
        expect(prompt.startsWith(explore)).toBe(true);
        expect(prompt).toContain('Parent project rules');
        expect(prompt).toContain('keep it short');
    });

    it('omits parent context / extraSystem when absent', () => {
        const spec: ForkSpec = {
            agent: BUILT_IN_AGENTS['plan']!,
            task: 'do plan',
            toolNames: ['read_file'],
        };
        const prompt = buildSubagentSystemPrompt({ readFiles: [] }, spec);
        expect(prompt).not.toContain('Parent context');
    });
});

describe('forkSubagent (P16b)', () => {
    it('hydrates child readFiles, installs system prompt, seeds user message, runs child, snapshots memory', async () => {
        const child = makeStubChild();
        const ranWith: string[] = [];
        const result = await forkSubagent(
            { baseSystemPrompt: 'rules', readFiles: ['pre-read.ts'] },
            {
                agent: BUILT_IN_AGENTS['explore']!,
                task: 'find the tokenizer',
                toolNames: ['read_file'],
            },
            {
                createChildSession: () => child,
                runChild: async (s, _spec) => {
                    ranWith.push((s as unknown as { messages: Array<{ content: string }> }).messages[0]?.content ?? '');
                    child.messages.push({ role: 'assistant', content: 'found it' });
                },
            },
        );

        expect(ranWith).toEqual(['find the tokenizer']);
        expect(child.hydrated).toEqual(['pre-read.ts']);
        expect(child.system).toContain(BUILT_IN_AGENTS['explore']!.systemPrompt);
        expect(result.agentName).toBe('explore');
        expect(result.snapshot.finalResponse).toBe('found it');
    });

    it('propagates runner errors to the caller', async () => {
        const child = makeStubChild();
        await expect(forkSubagent(
            { readFiles: [] },
            { agent: BUILT_IN_AGENTS['plan']!, task: 't', toolNames: [] },
            {
                createChildSession: () => child,
                runChild: async () => { throw new Error('boom'); },
            },
        )).rejects.toThrow(/boom/);
    });
});

describe('assertToolsAllowed (P16b)', () => {
    it('accepts tools listed explicitly', () => {
        expect(() => assertToolsAllowed(['read_file'], BUILT_IN_AGENTS['plan']!)).not.toThrow();
    });
    it('accepts prefix matches via trailing *', () => {
        expect(() => assertToolsAllowed(['lsp_hover'], BUILT_IN_AGENTS['explore']!)).not.toThrow();
    });
    it('passes everything for general-purpose [*]', () => {
        expect(() => assertToolsAllowed(['anything'], BUILT_IN_AGENTS['general-purpose']!)).not.toThrow();
    });
    it('throws on disallowed tool', () => {
        expect(() => assertToolsAllowed(['run_shell'], BUILT_IN_AGENTS['plan']!)).toThrow(/not in allowedTools/);
    });
});

describe('findFinalAssistantContent (P16b)', () => {
    it('returns the last assistant message content', () => {
        const content = findFinalAssistantContent([
            { role: 'user', content: 'u1' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'u2' },
            { role: 'assistant', content: 'a2  ' },
        ]);
        expect(content).toBe('a2');
    });
    it('returns undefined when no assistant messages', () => {
        expect(findFinalAssistantContent([{ role: 'user', content: 'u' }])).toBeUndefined();
    });
});
