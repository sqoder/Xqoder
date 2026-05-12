import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { LLMMessage, StreamCallbacks } from '@xqoder/shared';
import type {
    CompletionRequest,
    CompletionResponse,
    ILLMProvider,
} from '../../../../shared/llm-api/base.js';
import { decideShellPolicy } from '../decide.js';
import {
    resetClassifierDegradeThresholdForTests,
    resetClassifierDenials,
    setClassifierDegradeThresholdForTests,
} from '../denial-tracking.js';

function blockingProvider(block: boolean, reason = 'mocked'): ILLMProvider {
    return {
        name: 'mock',
        model: 'haiku-mock',
        async complete(_request: CompletionRequest): Promise<CompletionResponse> {
            return {
                message: {
                    role: 'assistant',
                    content: '',
                    toolCalls: [
                        {
                            id: 'c',
                            name: 'classify_result',
                            arguments: JSON.stringify({ block, reason }),
                        },
                    ],
                },
                usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
                finishReason: 'tool_calls',
            };
        },
        async stream(_r: CompletionRequest, _c: StreamCallbacks): Promise<CompletionResponse> {
            throw new Error('unused');
        },
    };
}

function neverCalledProvider(): ILLMProvider {
    return {
        name: 'should-not-fire',
        model: 'unused',
        async complete() {
            throw new Error('LLM classifier should not run on rule hit');
        },
        async stream() {
            throw new Error('unused');
        },
    };
}

const sessionId = 'session-decide-test';

beforeEach(() => {
    resetClassifierDenials();
});

afterEach(() => {
    resetClassifierDegradeThresholdForTests();
});

describe('decideShellPolicy — rule hits short-circuit', () => {
    it('dangerous rule wins without touching the LLM provider', async () => {
        const result = await decideShellPolicy({
            command: 'sudo rm -rf /',
            sessionId,
            transcriptTail: [],
            llmEnabled: true,
            makeProvider: () => neverCalledProvider(),
        });
        expect(result.decision).toBe('deny');
        expect(result.source).toBe('rule-dangerous');
    });

    it('safe rule wins without touching the LLM provider', async () => {
        const result = await decideShellPolicy({
            command: 'git status',
            sessionId,
            transcriptTail: [],
            llmEnabled: true,
            makeProvider: () => neverCalledProvider(),
        });
        expect(result.decision).toBe('allow');
        expect(result.source).toBe('rule-safe');
    });
});

describe('decideShellPolicy — LLM layer disabled (flag off)', () => {
    it('unknown command returns ask with fallback source', async () => {
        const result = await decideShellPolicy({
            command: 'uvx some-random-tool',
            sessionId,
            transcriptTail: [],
            llmEnabled: false,
            makeProvider: () => neverCalledProvider(),
        });
        expect(result.decision).toBe('ask');
        expect(result.source).toBe('fallback');
    });

    it('does not call the provider factory for tier 1 when flag is off', async () => {
        let called = false;
        const result = await decideShellPolicy({
            command: 'python manage.py migrate',
            sessionId,
            transcriptTail: [],
            llmEnabled: false,
            makeProvider: () => {
                called = true;
                return neverCalledProvider();
            },
        });
        expect(called).toBe(false);
        expect(result.decision).toBe('ask');
    });
});

describe('decideShellPolicy — LLM layer engaged', () => {
    it('LLM allow propagates to decision', async () => {
        const result = await decideShellPolicy({
            command: 'terraform plan',
            sessionId,
            transcriptTail: [],
            llmEnabled: true,
            makeProvider: () => blockingProvider(false, 'read-only plan'),
        });
        expect(result.decision).toBe('allow');
        expect(result.source).toBe('llm-stage1');
    });

    it('LLM deny propagates when denial-tracking threshold not reached', async () => {
        const result = await decideShellPolicy({
            command: 'terraform apply -auto-approve',
            sessionId,
            transcriptTail: [],
            llmEnabled: true,
            makeProvider: () => blockingProvider(true, 'mutates prod'),
        });
        expect(result.decision).toBe('deny');
        expect(result.source).toBe('llm-stage2');
    });

    it('provider factory unavailable → ask + llm-unavailable', async () => {
        const result = await decideShellPolicy({
            command: 'uvx tool',
            sessionId,
            transcriptTail: [],
            llmEnabled: true,
            makeProvider: () => undefined,
        });
        expect(result.decision).toBe('ask');
        expect(result.source).toBe('llm-unavailable');
    });
});

describe('decideShellPolicy — denial tracking degrades repeated denies to ask', () => {
    it('third LLM deny in a session is downgraded to ask with denial-tracked source', async () => {
        setClassifierDegradeThresholdForTests(3);
        const args = {
            sessionId: 'session-denial-tracking',
            transcriptTail: [] as LLMMessage[],
            llmEnabled: true,
            makeProvider: () => blockingProvider(true, 'keeps denying'),
        };

        const r1 = await decideShellPolicy({ command: 'terraform apply', ...args });
        expect(r1.decision).toBe('deny');
        expect(r1.source).toBe('llm-stage2');

        const r2 = await decideShellPolicy({ command: 'kubectl delete ns prod', ...args });
        expect(r2.decision).toBe('deny');
        expect(r2.source).toBe('llm-stage2');

        const r3 = await decideShellPolicy({ command: 'ansible-playbook prod.yml', ...args });
        expect(r3.decision).toBe('ask');
        expect(r3.source).toBe('denial-tracked');
        expect(r3.reason).toContain('handing control back to user');
    });

    it('denial tracking does not degrade rule-layer deny', async () => {
        setClassifierDegradeThresholdForTests(1);
        // Rule-based deny should never be degraded — safety is explicit, not LLM-inferred.
        const result = await decideShellPolicy({
            command: 'sudo rm -rf /',
            sessionId: 'rule-session',
            transcriptTail: [],
            llmEnabled: true,
            makeProvider: () => neverCalledProvider(),
        });
        expect(result.decision).toBe('deny');
        expect(result.source).toBe('rule-dangerous');
    });
});
