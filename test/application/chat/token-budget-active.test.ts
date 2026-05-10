// P10 token-budget active trigger tests.
// Confirms the TOKEN_BUDGET_ACTIVE feature flag gates `maybeActiveTokenBudgetCompact`
// and that an `exhausted` budget walks the snip/micro ladder via applyProgressiveCompaction.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { LLMMessage, Logger, LLMProviderConfig } from '@xqoder/shared';
import type { AgentSession, AgentRuntimeProfile } from '@xqoder/agent';
import { maybeActiveTokenBudgetCompact } from '../../../src/application/chat/compaction-pipeline.js';
import { resetFeatureCache } from '../../../src/shared/feature-flags.js';

interface RecordingLogger extends Logger {
    readonly warnings: string[];
    readonly debugs: string[];
}

function createRecordingLogger(): RecordingLogger {
    const warnings: string[] = [];
    const debugs: string[] = [];
    return {
        info: () => {},
        warn: (msg: string) => { warnings.push(String(msg)); },
        error: () => {},
        debug: (msg: string) => { debugs.push(String(msg)); },
        success: () => {},
        warnings,
        debugs,
    } as unknown as RecordingLogger;
}

interface StubSessionState {
    readonly session: AgentSession;
    readonly getCalls: number[];
    readonly replaceCalls: LLMMessage[][];
}

function createStubSession(initial: LLMMessage[]): StubSessionState {
    const getCalls: number[] = [];
    const replaceCalls: LLMMessage[][] = [];
    let messages = initial.slice();
    const session = {
        getMessages: () => {
            getCalls.push(messages.length);
            return messages.slice();
        },
        replaceMessages: (next: LLMMessage[]) => {
            replaceCalls.push(next.slice());
            messages = next.slice();
        },
        getToolHistory: () => [],
        performCompaction: () => {},
    } as unknown as AgentSession;
    return { session, getCalls, replaceCalls };
}

function largeUserContent(chars: number): string {
    return 'x'.repeat(chars);
}

function baseDeps(session: AgentSession, logger: Logger, profile: AgentRuntimeProfile = 'default'): Parameters<typeof maybeActiveTokenBudgetCompact>[0] {
    return {
        session,
        logger,
        llmConfig: {
            provider: 'anthropic',
            // 200k context window so that small content is 'ok' and huge content is 'exhausted'
            model: 'claude-3-5-sonnet-20241022',
        } as LLMProviderConfig,
        runtimeProfile: profile,
        compaction: undefined,
        callbacks: undefined,
        streamId: 'stream-p10',
        emit: () => {},
    } as Parameters<typeof maybeActiveTokenBudgetCompact>[0];
}

beforeEach(() => {
    resetFeatureCache();
    delete process.env.XQODER_FEATURE_TOKEN_BUDGET_ACTIVE;
    delete process.env.XQODER_DISABLE_ADVANCED_COMPACT;
});

afterEach(() => {
    delete process.env.XQODER_FEATURE_TOKEN_BUDGET_ACTIVE;
    delete process.env.XQODER_DISABLE_ADVANCED_COMPACT;
    resetFeatureCache();
});

describe('maybeActiveTokenBudgetCompact — feature gate', () => {
    it('returns immediately when TOKEN_BUDGET_ACTIVE is off (default)', async () => {
        const stub = createStubSession([{ role: 'user', content: largeUserContent(200_000) }]);
        const logger = createRecordingLogger();
        await maybeActiveTokenBudgetCompact(baseDeps(stub.session, logger));
        expect(stub.getCalls.length).toBe(0);
        expect(logger.warnings.length).toBe(0);
    });

    it('returns immediately when runtimeProfile=mvp even with flag on', async () => {
        process.env.XQODER_FEATURE_TOKEN_BUDGET_ACTIVE = '1';
        resetFeatureCache();
        const stub = createStubSession([{ role: 'user', content: largeUserContent(200_000) }]);
        const logger = createRecordingLogger();
        await maybeActiveTokenBudgetCompact(baseDeps(stub.session, logger, 'mvp'));
        expect(stub.getCalls.length).toBe(0);
        expect(logger.warnings.length).toBe(0);
    });

    it('returns immediately when XQODER_DISABLE_ADVANCED_COMPACT=1', async () => {
        process.env.XQODER_FEATURE_TOKEN_BUDGET_ACTIVE = '1';
        process.env.XQODER_DISABLE_ADVANCED_COMPACT = '1';
        resetFeatureCache();
        const stub = createStubSession([{ role: 'user', content: largeUserContent(200_000) }]);
        const logger = createRecordingLogger();
        await maybeActiveTokenBudgetCompact(baseDeps(stub.session, logger));
        expect(stub.getCalls.length).toBe(0);
        expect(logger.warnings.length).toBe(0);
    });
});

describe('maybeActiveTokenBudgetCompact — triggered path', () => {
    it('skips compaction when budget is "ok"', async () => {
        process.env.XQODER_FEATURE_TOKEN_BUDGET_ACTIVE = '1';
        resetFeatureCache();
        const stub = createStubSession([{ role: 'user', content: 'hello world' }]);
        const logger = createRecordingLogger();
        await maybeActiveTokenBudgetCompact(baseDeps(stub.session, logger));
        // getMessages is called once for the budget check.
        expect(stub.getCalls.length).toBe(1);
        expect(stub.replaceCalls.length).toBe(0);
        expect(logger.warnings.length).toBe(0);
    });

    it('logs a warn and invokes the byte-based pipeline when budget is exhausted', async () => {
        process.env.XQODER_FEATURE_TOKEN_BUDGET_ACTIVE = '1';
        resetFeatureCache();
        // claude-3-5-sonnet context window is 200k; 1M chars → 250k tokens → exhausted.
        const stub = createStubSession([{ role: 'user', content: largeUserContent(1_000_000) }]);
        const logger = createRecordingLogger();
        await maybeActiveTokenBudgetCompact(baseDeps(stub.session, logger));
        expect(logger.warnings.some((w) => w.includes('token budget'))).toBe(true);
        expect(stub.getCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('does nothing when llmConfig.model has no context-window metadata', async () => {
        process.env.XQODER_FEATURE_TOKEN_BUDGET_ACTIVE = '1';
        resetFeatureCache();
        const stub = createStubSession([{ role: 'user', content: largeUserContent(200_000) }]);
        const logger = createRecordingLogger();
        const deps = baseDeps(stub.session, logger);
        (deps.llmConfig as { model: string }).model = 'made-up-model-no-window';
        await maybeActiveTokenBudgetCompact(deps);
        expect(logger.warnings.length).toBe(0);
        // one getMessages call is fine — it's the budget check that returns 'ok'.
        expect(stub.getCalls.length).toBeLessThanOrEqual(1);
    });
});
