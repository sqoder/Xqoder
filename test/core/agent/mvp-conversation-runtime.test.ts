import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { AgentSession } from '../../../src/core/agent/session/session.js';
import { createMvpConversationRuntime } from '../../../src/core/agent/mvp/conversation-runtime.js';
import type { MvpRuntimeConfig } from '../../../src/core/agent/mvp/types.js';

const createdPaths = new Set<string>();

afterEach(() => {
    for (const createdPath of createdPaths) {
        fs.rmSync(createdPath, { recursive: true, force: true });
    }
    createdPaths.clear();
});

describe('mvp conversation runtime adapter', () => {
    it('builds planner prompts for question turns without forcing tool evidence', () => {
        const projectRoot = createTempDir('xqoder-mvp-runtime-question-');
        const session = new AgentSession({ id: 'mvp-runtime-question', systemPrompt: 'system' });
        const runtime = createMvpConversationRuntime({
            userGoal: '你好',
            projectRoot,
            session,
            runtimeProfile: 'mvp',
            runtimeConfig: createRuntimeConfig(),
        });

        const messages = runtime.prepareMessages();
        const plannerPrompt = String(messages.at(-1)?.content ?? '');

        expect(plannerPrompt).toContain('Planner decision:');
        expect(plannerPrompt).toContain('- Task type: question');
        expect(plannerPrompt).toContain('- Preferred next action: answer');
        expect(runtime.getNoToolCompletionBlocker(false)).toBeUndefined();
        expect(runtime.finalizeAssistantResponse('你好，我在。')).toBe('你好，我在。');
    });

    it('owns loop stop/tool-evidence policy outside the verification controller', () => {
        const projectRoot = createTempDir('xqoder-mvp-runtime-engineering-');
        const session = new AgentSession({ id: 'mvp-runtime-engineering', systemPrompt: 'system' });
        const runtime = createMvpConversationRuntime({
            userGoal: 'fix src/router.ts route bug',
            projectRoot,
            session,
            runtimeProfile: 'hybrid',
            runtimeConfig: createRuntimeConfig({
                stopConditions: {
                    hard: [],
                    soft: [],
                    maxLoops: 1,
                },
            }),
        });

        runtime.prepareMessages();
        expect(runtime.getNoToolCompletionBlocker(false)).toContain('No tool activity was recorded in this run.');
        expect(runtime.getForcedStopMessage()).toBeUndefined();

        runtime.prepareMessages();
        expect(runtime.getForcedStopMessage()).toContain('max_loops');
    });
});

function createRuntimeConfig(overrides: Partial<MvpRuntimeConfig> = {}): MvpRuntimeConfig {
    return {
        baselineCheck: false,
        distillVerifier: false,
        stopConditions: {
            hard: ['all_tests_pass'],
            soft: [],
            maxLoops: 4,
        },
        ...overrides,
    };
}

function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    createdPaths.add(dir);
    return dir;
}
