import { afterEach, describe, expect, it } from 'vitest';
import {
    __resetTodaySessionStatsCacheForTest,
    __setTodaySessionStatsStoreFactoryForTest,
} from '../services/today-session-stats.js';
import { createInitialTerminalAppState } from './app-state.js';
import {
    getProjectedActiveViewportHeight,
    getProjectedLogViewportHeight,
    getProjectedTranscriptViewportHeight,
    reduceProtocolEventToTerminalState,
    reduceUiToolFeedbackToTerminalState,
    restoreTerminalHistory,
    withDerivedChrome,
} from './runtime-bridge.js';

afterEach(() => {
    __resetTodaySessionStatsCacheForTest();
});

describe('runtime bridge', () => {
    it('prefers projected transcript viewport height and falls back when projection is missing', () => {
        const base = createInitialTerminalAppState({ width: 80, height: 24 });

        expect(getProjectedTranscriptViewportHeight({
            size: base.size,
            viewport: { ...base.viewport, viewportHeight: 7 },
        } as any)).toBe(7);

        expect(getProjectedTranscriptViewportHeight({
            size: base.size,
            viewport: { ...base.viewport, viewportHeight: 0 },
        } as any)).toBe(16);

        expect(getProjectedTranscriptViewportHeight({
            size: base.size,
            viewport: { ...base.viewport, viewportHeight: 0 },
        } as any, 11)).toBe(11);
    });

    it('prefers projected log viewport height and supports caller fallback height', () => {
        const base = createInitialTerminalAppState({ width: 80, height: 24 });

        expect(getProjectedLogViewportHeight({
            logViewport: { ...base.logViewport, viewportHeight: 9 },
        } as any)).toBe(9);

        expect(getProjectedLogViewportHeight({
            logViewport: { ...base.logViewport, viewportHeight: 0 },
        } as any, 13)).toBe(13);
    });

    it('resolves active viewport height by page', () => {
        const base = createInitialTerminalAppState({ width: 80, height: 24 });

        expect(getProjectedActiveViewportHeight({
            size: base.size,
            page: 'chat',
            viewport: { ...base.viewport, viewportHeight: 0 },
            logViewport: { ...base.logViewport, viewportHeight: 9 },
        } as any)).toBe(16);

        expect(getProjectedActiveViewportHeight({
            size: base.size,
            page: 'logs',
            viewport: { ...base.viewport, viewportHeight: 0 },
            logViewport: { ...base.logViewport, viewportHeight: 9 },
        } as any)).toBe(9);

        expect(getProjectedActiveViewportHeight({
            size: base.size,
            page: 'logs',
            viewport: { ...base.viewport, viewportHeight: 0 },
            logViewport: { ...base.logViewport, viewportHeight: 0 },
        } as any, { logFallbackHeight: 12 })).toBe(12);
    });

    it('applies protocol streaming events to terminal app state', () => {
        let state = createInitialTerminalAppState({ width: 80, height: 24 }, { cwd: '/repo', model: 'gpt-4.1', agent: 'general' });

        state = reduceProtocolEventToTerminalState(state, {
            type: 'message.started',
            sessionId: 'session-1',
            timestamp: 1,
            source: 'agent',
            message: {
                id: 'assistant-1',
                sessionId: 'session-1',
                role: 'assistant',
                content: '',
                createdAt: 1,
            },
        });
        state = reduceProtocolEventToTerminalState(state, {
            type: 'message.delta',
            sessionId: 'session-1',
            timestamp: 2,
            source: 'agent',
            messageId: 'assistant-1',
            role: 'assistant',
            text: 'Hello',
        });

        expect(state.transcriptEntries[0]?.content).toBe('Hello');
        expect(state.transcriptLines.join('\n')).toContain('Hello');
        expect(state.sidebar[1]?.lines[0]).toBe('session-1');
    });

    it('restores persisted history and surfaces approval/tool feedback', () => {
        let state = restoreTerminalHistory(
            createInitialTerminalAppState({ width: 80, height: 24 }, { cwd: '/repo' }),
            {
                sessionId: 'session-1',
                title: 'hello',
                cwd: '/repo',
                messages: [
                    { role: 'user', content: 'hello' },
                    { role: 'assistant', content: 'world' },
                ],
            },
        );

        expect(state.transcriptLines.join('\n')).toContain('hello');
        expect(state.transcriptLines.join('\n')).toContain('world');

        state = reduceProtocolEventToTerminalState(state, {
            type: 'tool.called',
            sessionId: 'session-1',
            timestamp: 3,
            source: 'tool',
            provider: 'xqoder-agent',
            tool: 'read_file',
            args: { path: 'README.md' },
        });
        state = reduceProtocolEventToTerminalState(state, {
            type: 'tool.output',
            sessionId: 'session-1',
            timestamp: 4,
            source: 'tool',
            provider: 'xqoder-agent',
            tool: 'read_file',
            output: 'README content',
            partial: false,
        });
        state = reduceProtocolEventToTerminalState(state, {
            type: 'approval.requested',
            sessionId: 'session-1',
            timestamp: 5,
            source: 'agent',
            requestId: 'approval-1',
            kind: 'tool.use',
            summary: 'Need permission',
            payload: 'preview text',
        });

        expect(state.transcriptLines.join('\n')).toContain('Thinking: Gathered context · 2 reads');
        expect(state.pendingApproval?.summary).toBe('Need permission');
        expect(state.sidebar.some((section) => section.title === 'Approval')).toBe(true);
    });

    it('does not inject placeholder thinking text before assistant deltas', () => {
        const state = reduceProtocolEventToTerminalState(createInitialTerminalAppState({ width: 80, height: 24 }), {
            type: 'message.started',
            sessionId: 'session-1',
            timestamp: 1,
            source: 'agent',
            message: {
                id: 'assistant-1',
                sessionId: 'session-1',
                role: 'assistant',
                content: '',
                createdAt: 1,
            },
        });

        expect(state.transcriptEntries[0]?.content).toBe('');
        expect(state.transcriptLines.join('\n')).not.toContain('Thinking...');
    });

    it('renders diff-style tool previews for patch calls', () => {
        const state = reduceProtocolEventToTerminalState(createInitialTerminalAppState({ width: 100, height: 30 }), {
            type: 'tool.called',
            sessionId: 'session-1',
            timestamp: 10,
            source: 'tool',
            provider: 'xqoder-agent',
            tool: 'apply_patch',
            args: {
                patchText: ['*** Begin Patch', '*** Update File: a.ts', '-oldLine', '+newLine', '*** End Patch'].join('\n'),
            },
        });

        const output = state.transcriptLines.join('\n');
        expect(output).toContain('Awaiting absolute path');
        expect(output).toContain('apply_patch');
        expect(output).toContain('Write operation requested but target path is not absolute');
    });

    it('renders diff-style tool previews for write_file calls', () => {
        const state = reduceProtocolEventToTerminalState(createInitialTerminalAppState({ width: 100, height: 30 }), {
            type: 'tool.called',
            sessionId: 'session-1',
            timestamp: 10,
            source: 'tool',
            provider: 'xqoder-agent',
            tool: 'write_file',
            args: {
                path: 'src/a.ts',
                content: 'const x = 1;\nconsole.log(x);',
            },
        });

        const output = state.transcriptLines.join('\n');
        expect(output).toContain('Awaiting absolute path');
        expect(output).toContain('write_file');
        expect(output).toContain('src/a.ts');
    });

    it('appends patched summary card after successful patch completion', () => {
        let state = reduceProtocolEventToTerminalState(createInitialTerminalAppState({ width: 100, height: 30 }), {
            type: 'tool.called',
            sessionId: 'session-1',
            timestamp: 10,
            source: 'tool',
            provider: 'xqoder-agent',
            tool: 'apply_patch',
            args: {
                patchText: ['*** Begin Patch', '*** Update File: /tmp/src/app.ts', '-oldLine', '+newLine', '*** End Patch'].join('\n'),
            },
        });
        state = reduceProtocolEventToTerminalState(state, {
            type: 'tool.output',
            sessionId: 'session-1',
            timestamp: 10,
            source: 'tool',
            provider: 'xqoder-agent',
            tool: 'apply_patch',
            partial: false,
            output: ['*** Begin Patch', '*** Update File: /tmp/src/app.ts', '-oldLine', '+newLine', '*** End Patch'].join('\n'),
        });
        state = reduceProtocolEventToTerminalState(state, {
            type: 'tool.completed',
            sessionId: 'session-1',
            timestamp: 11,
            source: 'tool',
            provider: 'xqoder-agent',
            tool: 'apply_patch',
            success: true,
        });

        const output = state.transcriptLines.join('\n');
        expect(output).toContain('Patched /tmp/src/app.ts');
        expect(output).toContain('```diff');
        expect(output).toContain('+newLine');
    });

    it('strips emoji from assistant replies', () => {
        let state = createInitialTerminalAppState({ width: 80, height: 24 });
        state = reduceProtocolEventToTerminalState(state, {
            type: 'message.started',
            sessionId: 'session-1',
            timestamp: 1,
            source: 'agent',
            message: {
                id: 'assistant-1',
                sessionId: 'session-1',
                role: 'assistant',
                content: 'Hello 👋',
                createdAt: 1,
            },
        });
        state = reduceProtocolEventToTerminalState(state, {
            type: 'message.delta',
            sessionId: 'session-1',
            timestamp: 2,
            source: 'agent',
            messageId: 'assistant-1',
            role: 'assistant',
            text: ' Nice to meet you 😊',
        });

        expect(state.transcriptEntries[0]?.content).toBe('Hello  Nice to meet you ');
        expect(state.transcriptLines.join('\n')).not.toContain('👋');
        expect(state.transcriptLines.join('\n')).not.toContain('😊');
    });

    it('normalizes non-English approval and question prompts to global English UI copy', () => {
        let state = reduceProtocolEventToTerminalState(createInitialTerminalAppState({ width: 100, height: 30 }), {
            type: 'approval.requested',
            sessionId: 'session-1',
            timestamp: 1,
            source: 'agent',
            requestId: 'r1',
            kind: 'tool.use',
            summary: '权限申请',
            payload: '是否允许访问路径',
        });

        expect(state.pendingApproval?.summary).toBe('Permission request');
        expect(state.pendingApproval?.payload).toBe('Review request details and choose Allow or Deny.');

        state = reduceProtocolEventToTerminalState(state, {
            type: 'question.requested',
            sessionId: 'session-1',
            timestamp: 2,
            source: 'agent',
            requestId: 'q1',
            question: '是否允许访问并修改该目录？',
            options: [
                { label: '允许' },
                { label: '拒绝' },
            ],
            multiple: false,
            allowCustom: false,
        });

        expect(state.pendingQuestion?.question).toBe('Allow access to the requested resource?');
        expect(state.notice).toBe('Allow access to the requested resource?');
    });

    it('rejects ui-sourced domain events in runtime bridge', () => {
        expect(() => reduceProtocolEventToTerminalState(
            createInitialTerminalAppState({ width: 80, height: 24 }),
            {
                type: 'tool.called',
                sessionId: 'session-1',
                timestamp: 1,
                source: 'ui',
                provider: 'xqoder-ui',
                tool: 'workflow',
                args: { name: 'deploy' },
            },
        )).toThrow(/Domain→View mapping violated/);
    });

    it('rejects every protocol domain event when source is ui', () => {
        const timestamp = 1700000000000;
        const events = [
            {
                type: 'session.started',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                cwd: '/repo',
            },
            {
                type: 'session.resumed',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                messageCount: 3,
            },
            {
                type: 'message.started',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                message: {
                    id: 'assistant-1',
                    sessionId: 'session-1',
                    role: 'assistant',
                    content: 'hello',
                    createdAt: timestamp,
                },
            },
            {
                type: 'message.delta',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                messageId: 'assistant-1',
                role: 'assistant',
                text: 'delta',
            },
            {
                type: 'message.completed',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                message: {
                    id: 'assistant-1',
                    sessionId: 'session-1',
                    role: 'assistant',
                    content: 'done',
                    createdAt: timestamp,
                },
            },
            {
                type: 'tool.called',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                provider: 'ui',
                tool: 'read_file',
                args: { path: '/repo/README.md' },
            },
            {
                type: 'tool.output',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                provider: 'ui',
                tool: 'read_file',
                output: 'content',
                partial: false,
            },
            {
                type: 'tool.completed',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                provider: 'ui',
                tool: 'read_file',
                success: true,
            },
            {
                type: 'approval.requested',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                requestId: 'approval-1',
                kind: 'tool.use',
                summary: 'Need permission',
                payload: 'payload',
            },
            {
                type: 'approval.resolved',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                requestId: 'approval-1',
                decision: 'allow',
            },
            {
                type: 'question.requested',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                requestId: 'question-1',
                question: 'Allow?',
                options: [{ label: 'Allow' }, { label: 'Deny' }],
                multiple: false,
                allowCustom: false,
            },
            {
                type: 'question.resolved',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                requestId: 'question-1',
                selected: ['Allow'],
                answerSource: 'ui',
            },
            {
                type: 'status.changed',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                status: 'thinking',
            },
            {
                type: 'error',
                sessionId: 'session-1',
                timestamp,
                source: 'ui',
                message: 'error',
                recoverable: true,
            },
        ] as const;

        for (const event of events) {
            expect(() => reduceProtocolEventToTerminalState(
                createInitialTerminalAppState({ width: 80, height: 24 }),
                event as Parameters<typeof reduceProtocolEventToTerminalState>[1],
            )).toThrow(/Domain→View mapping violated/);
        }
    });

    it('accepts ui.tool.feedback events as ui-local view updates', () => {
        const base = createInitialTerminalAppState({ width: 100, height: 30 });
        const next = reduceUiToolFeedbackToTerminalState(
            {
                ...base,
                runtimeNotice: 'runtime notice',
                runtimeStatus: 'thinking',
            },
            {
                type: 'ui.tool.feedback.called',
                sessionId: 'session-1',
                timestamp: 1,
                tool: 'read_file',
                args: { path: '/repo/README.md' },
            },
        );

        expect(next.runtimeNotice).toBe('runtime notice');
        expect(next.uiNotice).toBe('tool read_file');
        expect(next.runtimeStatus).toBe('running-tool');
    });

    it('derives renderer status from runtime state and model context window', () => {
        const base = createInitialTerminalAppState(
            { width: 80, height: 24 },
            { model: 'gpt-4o', cwd: '/repo' },
        );
        const state = withDerivedChrome({
            ...base,
            runtimeStatus: 'running-tool',
            runtimeNotice: 'tool read_file',
            editor: {
                ...base.editor,
                value: 'const message = "hello world";'.repeat(40),
            },
        });

        expect(state.rendererStatus.thinking).toBe(false);
        expect(state.rendererStatus.text).toBe('tool read_file');
        expect(state.rendererStatus.contextMax).toBe(128000);
        expect(state.rendererStatus.contextUsed).toBeGreaterThan(0);
        expect(state.rendererStatus.contextUsed).toBeLessThanOrEqual(state.rendererStatus.contextMax);
    });

    it('reads today stats through the service boundary instead of local sqlite logic', () => {
        __setTodaySessionStatsStoreFactoryForTest(() => ({
            listSessions() {
                return [{
                    id: 'session-1',
                    projectRoot: '/repo',
                    cwd: '/repo',
                    model: 'gpt-4o',
                    title: 'today',
                    createdAt: new Date('2026-03-24T08:00:00.000Z'),
                    updatedAt: new Date(),
                    maxMessages: 100,
                    messageCount: 7,
                    usage: {
                        promptTokens: 1000,
                        completionTokens: 500,
                        totalTokens: 1500,
                    },
                    compactionCount: 0,
                    commandCount: 0,
                    fileChangeCount: 0,
                }];
            },
        }));

        const state = withDerivedChrome(createInitialTerminalAppState({ width: 80, height: 24 }));

        expect(state.todayMessageCount).toBe(7);
        expect(state.costUsdToday).toBeGreaterThan(0);
    });
});
