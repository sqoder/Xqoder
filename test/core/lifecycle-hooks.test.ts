import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
    SUPPORTED_HOOK_EVENTS,
    isHookEventName,
    type HooksSettings,
} from '@xqoder/shared';
import {
    dispatchLifecycleHook,
    dispatchLifecycleHookFireAndForget,
    buildSessionStartPayload,
    buildSessionEndPayload,
    buildStopPayload,
    buildSubagentStopPayload,
    buildPreCompactPayload,
    buildPostCompactPayload,
    type LifecycleHookEventName,
} from '../../src/core/agent/lifecycle-hooks.js';

let CWD = '';
let PROJECT_ROOT = '';

beforeAll(() => {
    CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-lifecycle-'));
    PROJECT_ROOT = CWD;
});

afterAll(() => {
    if (CWD) {
        fs.rmSync(CWD, { recursive: true, force: true });
    }
});

describe('SUPPORTED_HOOK_EVENTS expansion (P14a)', () => {
    it('contains all 10 OpenClaude lifecycle + tool events', () => {
        const expected = new Set([
            'PreToolUse',
            'PostToolUse',
            'PostToolUseFailure',
            'UserPromptSubmit',
            'SessionStart',
            'SessionEnd',
            'Stop',
            'SubagentStop',
            'PreCompact',
            'PostCompact',
        ]);
        expect(new Set(SUPPORTED_HOOK_EVENTS)).toEqual(expected);
    });

    it('isHookEventName accepts every lifecycle event', () => {
        for (const event of ['SessionStart', 'SessionEnd', 'Stop', 'SubagentStop', 'PreCompact', 'PostCompact']) {
            expect(isHookEventName(event)).toBe(true);
        }
    });

    it('isHookEventName rejects unknown events', () => {
        expect(isHookEventName('PostSampling')).toBe(false);
        expect(isHookEventName('')).toBe(false);
    });
});

describe('lifecycle payload builders (P14a)', () => {
    it('SessionStart payload carries source + session metadata', () => {
        const payload = buildSessionStartPayload({
            sessionId: 'sess-1',
            cwd: CWD,
            projectRoot: PROJECT_ROOT,
            source: 'startup',
        });
        expect(payload).toEqual({
            hook_event_name: 'SessionStart',
            session_id: 'sess-1',
            cwd: CWD,
            project_root: PROJECT_ROOT,
            source: 'startup',
        });
    });

    it('SessionEnd payload carries reason; omits session_id when absent', () => {
        const payload = buildSessionEndPayload({
            cwd: CWD,
            projectRoot: PROJECT_ROOT,
            reason: 'clear',
        });
        expect(payload).toEqual({
            hook_event_name: 'SessionEnd',
            cwd: CWD,
            project_root: PROJECT_ROOT,
            reason: 'clear',
        });
    });

    it('Stop payload carries stop_hook_active', () => {
        const payload = buildStopPayload({
            cwd: CWD,
            projectRoot: PROJECT_ROOT,
            stopHookActive: true,
        });
        expect(payload.stop_hook_active).toBe(true);
    });

    it('SubagentStop payload carries subagent when provided', () => {
        const withAgent = buildSubagentStopPayload({
            cwd: CWD,
            projectRoot: PROJECT_ROOT,
            stopHookActive: false,
            subagent: 'code-reviewer',
        });
        expect(withAgent.subagent).toBe('code-reviewer');
        const withoutAgent = buildSubagentStopPayload({
            cwd: CWD,
            projectRoot: PROJECT_ROOT,
            stopHookActive: false,
        });
        expect('subagent' in withoutAgent).toBe(false);
    });

    it('PreCompact payload carries trigger + optional custom_instructions', () => {
        const manual = buildPreCompactPayload({
            cwd: CWD,
            projectRoot: PROJECT_ROOT,
            trigger: 'manual',
            customInstructions: 'preserve plan',
        });
        expect(manual.trigger).toBe('manual');
        expect(manual.custom_instructions).toBe('preserve plan');
        const auto = buildPreCompactPayload({
            cwd: CWD,
            projectRoot: PROJECT_ROOT,
            trigger: 'auto',
        });
        expect(auto.trigger).toBe('auto');
        expect('custom_instructions' in auto).toBe(false);
    });

    it('PostCompact payload carries before/after counts', () => {
        const payload = buildPostCompactPayload({
            cwd: CWD,
            projectRoot: PROJECT_ROOT,
            trigger: 'auto',
            messagesBefore: 42,
            messagesAfter: 7,
        });
        expect(payload.messages_before).toBe(42);
        expect(payload.messages_after).toBe(7);
    });
});

function makeCommandHook(response: Record<string, unknown>): HooksSettings {
    const json = JSON.stringify(response);
    return {
        SessionStart: [
            {
                hooks: [
                    { type: 'command', command: `cat >/dev/null; printf '%s' '${json}'` },
                ],
            },
        ],
    };
}

function buildRunnerConfig(overrides: Partial<{ disableAllHooks: boolean; hooks: HooksSettings }>): {
    cwd: string;
    projectRoot: string;
    disableAllHooks?: boolean;
    hooks?: HooksSettings;
} {
    return {
        cwd: CWD,
        projectRoot: PROJECT_ROOT,
        ...overrides,
    };
}

describe('dispatchLifecycleHook (P14a)', () => {
    it('returns unblocked when no hooks configured', async () => {
        const result = await dispatchLifecycleHook(
            'SessionStart',
            buildSessionStartPayload({ cwd: CWD, projectRoot: PROJECT_ROOT, source: 'startup' }),
            buildRunnerConfig({}),
        );
        expect(result.blocked).toBe(false);
        expect(result.handlers).toHaveLength(0);
    });

    it('short-circuits when disableAllHooks is true', async () => {
        const result = await dispatchLifecycleHook(
            'SessionStart',
            buildSessionStartPayload({ cwd: CWD, projectRoot: PROJECT_ROOT, source: 'startup' }),
            buildRunnerConfig({
                disableAllHooks: true,
                hooks: makeCommandHook({ decision: 'block', reason: 'nope' }),
            }),
        );
        expect(result.blocked).toBe(false);
    });

    it('executes command handler and collects additionalContext', async () => {
        const result = await dispatchLifecycleHook(
            'SessionStart',
            buildSessionStartPayload({ cwd: CWD, projectRoot: PROJECT_ROOT, source: 'startup' }),
            buildRunnerConfig({
                hooks: makeCommandHook({
                    hookSpecificOutput: { additionalContext: 'extra ctx' },
                }),
            }),
        );
        expect(result.blocked).toBe(false);
        expect(result.additionalContexts).toEqual(['extra ctx']);
    });

    it('treats decision=block as blocked with reason', async () => {
        const result = await dispatchLifecycleHook(
            'SessionStart',
            buildSessionStartPayload({ cwd: CWD, projectRoot: PROJECT_ROOT, source: 'startup' }),
            buildRunnerConfig({
                hooks: makeCommandHook({ decision: 'block', reason: 'blocked by guard' }),
            }),
        );
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('blocked by guard');
    });

    it('treats continue=false as blocked with stopReason', async () => {
        const result = await dispatchLifecycleHook(
            'SessionStart',
            buildSessionStartPayload({ cwd: CWD, projectRoot: PROJECT_ROOT, source: 'startup' }),
            buildRunnerConfig({
                hooks: makeCommandHook({ continue: false, stopReason: 'halt' }),
            }),
        );
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('halt');
    });

    it('dedupes repeated additionalContext entries across handlers', async () => {
        const hooks: HooksSettings = {
            SessionStart: [
                {
                    hooks: [
                        {
                            type: 'command',
                            command: `cat >/dev/null; printf '%s' '${JSON.stringify({ hookSpecificOutput: { additionalContext: 'dup' } })}'`,
                        },
                        {
                            type: 'command',
                            command: `cat >/dev/null; printf '%s' '${JSON.stringify({ hookSpecificOutput: { additionalContext: 'dup' } })}'`,
                        },
                    ],
                },
            ],
        };
        const result = await dispatchLifecycleHook(
            'SessionStart',
            buildSessionStartPayload({ cwd: CWD, projectRoot: PROJECT_ROOT, source: 'startup' }),
            buildRunnerConfig({ hooks }),
        );
        expect(result.additionalContexts).toEqual(['dup']);
        expect(result.handlers).toHaveLength(2);
    });

    it('swallows handler errors without blocking', async () => {
        const hooks: HooksSettings = {
            SessionStart: [
                {
                    hooks: [
                        { type: 'command', command: 'exit 17' },
                    ],
                },
            ],
        };
        const result = await dispatchLifecycleHook(
            'SessionStart',
            buildSessionStartPayload({ cwd: CWD, projectRoot: PROJECT_ROOT, source: 'startup' }),
            buildRunnerConfig({ hooks }),
        );
        expect(result.blocked).toBe(false);
        expect(result.handlers[0]?.error).toBeDefined();
    });
});

describe('dispatchLifecycleHookFireAndForget (P14a)', () => {
    it('returns synchronously and does not throw on handler error', async () => {
        const hooks: HooksSettings = {
            Stop: [
                { hooks: [{ type: 'command', command: 'exit 1' }] },
            ],
        };
        const payload = buildStopPayload({ cwd: CWD, projectRoot: PROJECT_ROOT, stopHookActive: false });
        // If this synchronously threw, the test would fail.
        expect(() => {
            dispatchLifecycleHookFireAndForget('Stop', payload, buildRunnerConfig({ hooks }));
        }).not.toThrow();
        // Give it a tick to settle so the background promise resolves before the test ends.
        await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('returns synchronously for every lifecycle event name', () => {
        const events: LifecycleHookEventName[] = [
            'SessionStart', 'SessionEnd', 'Stop', 'SubagentStop', 'PreCompact', 'PostCompact',
        ];
        for (const eventName of events) {
            const config = buildRunnerConfig({});
            const payload = buildSessionStartPayload({ cwd: CWD, projectRoot: PROJECT_ROOT, source: 'startup' });
            expect(() => {
                dispatchLifecycleHookFireAndForget(eventName, payload, config);
            }).not.toThrow();
        }
    });
});
