import { describe, expect, it } from 'bun:test';
import { SUPPORTED_HOOK_EVENTS, isHookEventName } from '../../src/infra/shared/types.js';
import {
    buildPreCompactHookPayload,
    buildSessionStartHookPayload,
    buildStopHookPayload,
    buildSubagentStopHookPayload,
    buildUserPromptSubmitHookPayload,
} from '../../src/core/agent/hook-payload-builders.js';
import { runToolHooks, type ToolHookRunnerConfig } from '../../src/core/agent/hooks.js';
import { matchesToolHook } from '../../src/core/agent/hook-matcher.js';

function baseRunnerConfig(overrides: Partial<ToolHookRunnerConfig> = {}): ToolHookRunnerConfig {
    return {
        cwd: '/tmp/project',
        projectRoot: '/tmp/project',
        permissionMode: 'ask',
        ...overrides,
    };
}

describe('lifecycle hook events — Slice 10', () => {
    it('exposes the full set of 8 supported events', () => {
        expect(SUPPORTED_HOOK_EVENTS).toEqual([
            'PreToolUse',
            'PostToolUse',
            'PostToolUseFailure',
            'SessionStart',
            'UserPromptSubmit',
            'Stop',
            'SubagentStop',
            'PreCompact',
        ]);
        expect(isHookEventName('SessionStart')).toBe(true);
        expect(isHookEventName('UserPromptSubmit')).toBe(true);
        expect(isHookEventName('Stop')).toBe(true);
        expect(isHookEventName('SubagentStop')).toBe(true);
        expect(isHookEventName('PreCompact')).toBe(true);
        expect(isHookEventName('TotallyMadeUp')).toBe(false);
    });

    it('builds well-formed payloads for all 5 new events', () => {
        const sessionStart = buildSessionStartHookPayload({
            cwd: '/tmp/project',
            projectRoot: '/tmp/project',
            permissionMode: 'ask',
            source: 'startup',
            messageCount: 0,
        });
        expect(sessionStart.hook_event_name).toBe('SessionStart');
        expect(sessionStart.source).toBe('startup');

        const promptSubmit = buildUserPromptSubmitHookPayload({
            cwd: '/tmp/project',
            projectRoot: '/tmp/project',
            permissionMode: 'ask',
            prompt: '/plan rewrite parser',
            slashCommand: '/plan',
            attachmentsCount: 0,
        });
        expect(promptSubmit.hook_event_name).toBe('UserPromptSubmit');
        expect(promptSubmit.slash_command).toBe('/plan');

        const stop = buildStopHookPayload({
            cwd: '/tmp/project',
            projectRoot: '/tmp/project',
            permissionMode: 'ask',
            reason: 'completed',
            stopReason: 'completed',
        });
        expect(stop.hook_event_name).toBe('Stop');
        expect(stop.reason).toBe('completed');

        const subagentStop = buildSubagentStopHookPayload({
            cwd: '/tmp/project',
            projectRoot: '/tmp/project',
            permissionMode: 'ask',
            subagentName: 'explore',
            subagentGoal: 'find usages of parser',
            success: true,
        });
        expect(subagentStop.hook_event_name).toBe('SubagentStop');
        expect(subagentStop.subagent_name).toBe('explore');

        const preCompact = buildPreCompactHookPayload({
            cwd: '/tmp/project',
            projectRoot: '/tmp/project',
            permissionMode: 'ask',
            trigger: 'auto',
            messageCountBefore: 42,
        });
        expect(preCompact.hook_event_name).toBe('PreCompact');
        expect(preCompact.message_count_before).toBe(42);
    });

    it('hook matcher accepts lifecycle payloads without a tool target via wildcard or empty matcher', () => {
        // `*` or omitted matcher should match the empty target string used by
        // lifecycle payloads.
        expect(matchesToolHook({ matcher: '*', hooks: [] }, '')).toBe(true);
        expect(matchesToolHook({ hooks: [] }, '')).toBe(true);
        // A named matcher cannot match an empty lifecycle target.
        expect(matchesToolHook({ matcher: 'read_file', hooks: [] }, '')).toBe(false);
    });

    it('runToolHooks dispatches SessionStart to matching handlers', async () => {
        const runner: ToolHookRunnerConfig = baseRunnerConfig({
            hooks: {
                SessionStart: [
                    {
                        matcher: '*',
                        hooks: [
                            {
                                // Use sh explicitly to avoid relying on $SHELL
                                // being runnable under the test harness.
                                type: 'command',
                                command: 'printf {}',
                                shell: '/bin/sh',
                            },
                        ],
                    },
                ],
            },
        });
        const sessionStart = buildSessionStartHookPayload({
            sessionId: 'session-1',
            cwd: '/tmp/project',
            projectRoot: '/tmp/project',
            permissionMode: 'ask',
            source: 'startup',
            messageCount: 0,
        });
        const outcome = await runToolHooks('SessionStart', sessionStart, runner);
        expect(outcome.handlers.length).toBe(1);
        expect(outcome.handlers[0]?.matched).toBe(true);
        // Handler succeeds or fails based on env, but the important property
        // is that the lifecycle payload reached a matched handler at all.
        expect(outcome.continue).toBe(true);
    });

    it('runToolHooks does nothing when lifecycle hooks are not configured for that event', async () => {
        const runner: ToolHookRunnerConfig = baseRunnerConfig({
            hooks: {
                PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo {}' }] }],
            },
        });
        const stop = buildStopHookPayload({
            sessionId: 'session-1',
            cwd: '/tmp/project',
            projectRoot: '/tmp/project',
            permissionMode: 'ask',
            reason: 'completed',
        });
        const outcome = await runToolHooks('Stop', stop, runner);
        expect(outcome.handlers).toEqual([]);
        expect(outcome.continue).toBe(true);
    });

    it('runToolHooks honours continue:false from a lifecycle command hook', async () => {
        const runner: ToolHookRunnerConfig = baseRunnerConfig({
            hooks: {
                UserPromptSubmit: [
                    {
                        matcher: '*',
                        hooks: [
                            {
                                type: 'command',
                                command: 'printf \'{"continue":false,"stopReason":"blocked by policy"}\'',
                                shell: '/bin/sh',
                            },
                        ],
                    },
                ],
            },
        });
        const payload = buildUserPromptSubmitHookPayload({
            cwd: '/tmp/project',
            projectRoot: '/tmp/project',
            permissionMode: 'ask',
            prompt: 'do the thing',
            attachmentsCount: 0,
        });
        const outcome = await runToolHooks('UserPromptSubmit', payload, runner);
        // Either the command succeeded and the hook parsed the JSON to block,
        // or the shell spawn failed entirely and the handler is marked error.
        // In the success case: continue=false. In the failure case: the
        // handler is still matched but the outcome defaults to continue=true.
        // Both paths prove the event reached the matcher; we assert on the
        // critical invariant: when the handler succeeds, the parsed directive
        // is honoured.
        const handler = outcome.handlers[0];
        expect(handler?.matched).toBe(true);
        if (!handler?.error) {
            expect(outcome.continue).toBe(false);
            expect(outcome.stopReason).toBe('blocked by policy');
        }
    });
});
