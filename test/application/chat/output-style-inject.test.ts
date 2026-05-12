import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    buildConversationTurnInput,
    prepareChatExecution,
} from '../../../src/application/chat/turn-intake.js';
import { writeOutputStyleSelection } from '../../../src/core/output-styles/selection.js';

function makeProject(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-output-style-inject-'));
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"p17-style","version":"0.0.1"}');
    // Isolate from developer's real user-level skill/style dirs.
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-output-style-home-'));
    process.env.HOME = emptyHome;
    return root;
}

function writeStyle(root: string, fileName: string, body: string): void {
    const dir = path.join(root, '.xqoder', 'output-styles');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), body, 'utf-8');
}

describe('prompt-composer output-style injection', () => {
    it('appends [OutputStyle=...] tail when a style is selected', () => {
        const root = makeProject();
        writeStyle(root, 'concise.md', `---
name: concise
description: Short answers
systemPromptAppend: "Be terse. Skip preamble."
---
body.`);
        writeOutputStyleSelection(root, 'concise');

        const turnInput = buildConversationTurnInput({ prompt: 'hello', cwd: root });
        const prepared = prepareChatExecution(turnInput);
        const systemPrompt = prepared.agentConfig.systemPrompt ?? '';
        expect(systemPrompt).toContain('[OutputStyle=concise]');
        expect(systemPrompt).toContain('Be terse. Skip preamble.');
    });

    it('does not inject when no style is selected', () => {
        const root = makeProject();
        const turnInput = buildConversationTurnInput({ prompt: 'hello', cwd: root });
        const prepared = prepareChatExecution(turnInput);
        const systemPrompt = prepared.agentConfig.systemPrompt ?? '';
        expect(systemPrompt).not.toContain('[OutputStyle=');
    });

    it('silently ignores a selection pointing at a missing style', () => {
        const root = makeProject();
        writeOutputStyleSelection(root, 'ghost-style');
        const turnInput = buildConversationTurnInput({ prompt: 'hello', cwd: root });
        const prepared = prepareChatExecution(turnInput);
        const systemPrompt = prepared.agentConfig.systemPrompt ?? '';
        expect(systemPrompt).not.toContain('[OutputStyle=');
    });
});
