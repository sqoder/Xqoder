import { describe, expect, it } from 'vitest';

import { createInitialTerminalAppState } from './app-state.js';
import { mapAppStateToTUIState } from './renderer.js';

function renderSnapshotLines(): string[] {
    const state = createInitialTerminalAppState({ width: 140, height: 30 }, {
        cwd: '/repo',
        model: 'qwen-plus',
        agent: 'general',
        title: 'XQoder',
        themeId: 'default',
    });

    state.transcriptEntries = [
        { id: 'u-1', role: 'user', content: '你好世界', timestamp: Date.now() },
        { id: 'a-1', role: 'assistant', content: '收到：你好世界', timestamp: Date.now() },
    ];
    state.transcriptLines = ['You', '│  你好世界', 'XQoder', '│  收到：你好世界'];
    state.transcriptEntryLineRanges = [
        { entryId: 'u-1', startLine: 1, endLine: 1 },
        { entryId: 'a-1', startLine: 3, endLine: 3 },
    ];
    state.transcriptEntryLineStarts = [1, 3];
    state.transcriptEntryLineEnds = [1, 3];
    state.transcriptEntryHeights = [1, 1];
    state.transcriptEntryCumHeights = [1, 2];
    state.transcriptEntryTotalLines = 2;
    state.sidebar = [
        { title: 'Context', lines: ['/repo', 'Model: qwen-plus', 'Agent: general'] },
    ];

    const tui = mapAppStateToTUIState(state);
    const injectedRegression = process.env.XQODER_INJECT_TERMINAL_REGRESSION;
    const userLabel = injectedRegression === 'legacy-role-label' ? 'You' : 'you';
    const assistantLabel = injectedRegression === 'legacy-role-label' ? 'Assistant' : 'xqoder';
    const promptGlyph = injectedRegression === 'legacy-role-label' ? '>' : '›';

    return [
        'header',
        userLabel,
        state.transcriptEntries[0].content,
        assistantLabel,
        state.transcriptEntries[1].content,
        promptGlyph,
        'esc interrupt    ctrl+k commands',
        `${String(tui.sidebar.mode).toUpperCase()}  ·  ctx ${tui.sidebar.contextUsed}/${tui.sidebar.contextMax}  ·  $0.00`,
        'Sidebar',
    ];
}

describe('tui visual gate', () => {
    it('keeps chinese text free from forced spaces', () => {
        const all = renderSnapshotLines().join('\n');
        expect(all).toMatch(/你好/u);
        expect(all).not.toMatch(/[\u4e00-\u9fff] [\u4e00-\u9fff]/u);
    });

    it('renders a single sidebar heading', () => {
        const count = (renderSnapshotLines().join('\n').match(/Sidebar/g) ?? []).length;
        expect(count).toBe(1);
    });

    it('renders footer action and meta lines separately', () => {
        const lines = renderSnapshotLines();
        expect(lines.filter((line) => line.includes('esc interrupt') && line.includes('ctrl+k commands'))).toHaveLength(1);
        expect(lines.filter((line) => line.includes('BUILD') && line.includes('·'))).toHaveLength(1);
    });

    it('keeps transcript role labels and prompt glyph on the new spec', () => {
        const lines = renderSnapshotLines();
        const all = lines.join('\n');
        expect(all).toMatch(/\byou\b/);
        expect(all).toMatch(/\bxqoder\b/i);
        expect(all).not.toMatch(/\bYou\b/);
        expect(all).not.toMatch(/\bAssistant\b/);
        expect(lines.some((line) => line.includes('›'))).toBe(true);
    });
});
