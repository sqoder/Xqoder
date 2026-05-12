import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
    buildConversationTurnInput,
    prepareChatExecution,
} from '../../../../src/application/chat/turn-intake.js';
import { resolveDirectChatCommandResponse } from '../../../../src/application/chat/direct-command.js';
import type { XQoderConfig } from '@xqoder/shared';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p11-wiring-'));
    tempDirs.push(dir);
    return dir;
}

function createLoadedConfig(): XQoderConfig {
    return {
        llm: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
            apiKey: 'test-key',
        },
    };
}

describe('P11 turn-intake wiring', () => {
    it('auto-attaches files referenced by @path in the prompt', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'README.md'), '# readme');
        const turnInput = buildConversationTurnInput({
            prompt: 'please explain @README.md',
            cwd,
            entrypoint: 'cli',
        });
        expect(turnInput.attachments.length).toBe(1);
        expect(turnInput.attachments[0]!.fileName).toBe('README.md');
    });

    it('does not auto-expand mentions for direct commands like /compact', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'README.md'), '# readme');
        const turnInput = buildConversationTurnInput({
            prompt: '/compact',
            cwd,
            entrypoint: 'cli',
        });
        expect(turnInput.attachments.length).toBe(0);
    });

    it('/help returns the direct help response', async () => {
        const cwd = createTempDir();
        const turnInput = buildConversationTurnInput({
            prompt: '/help',
            cwd,
            entrypoint: 'cli',
        });
        expect(turnInput.runtime.commandRoute.kind).toBe('help');
        const execution = prepareChatExecution(turnInput, {
            configManager: { load: () => createLoadedConfig() },
        });
        const response = await resolveDirectChatCommandResponse(execution);
        expect(response).toBeDefined();
        expect(response).toContain('/help');
        expect(response).toContain('/plan');
    });
});
