// P19d — coordinator tools (TeamCreate / TeamDelete / SendMessage / ReadMailbox) tests.

import { afterEach, describe, expect, it } from 'bun:test';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { __resetTeamRegistryForTests } from '../../../src/core/coordinator/coordinator-mode.js';
import {
    ReadMailboxTool,
    SendMessageTool,
    TeamCreateTool,
    TeamDeleteTool,
} from '../../../src/core/agent/tools/coordinator-tools.js';
import type { ToolContext } from '../../../src/core/agent/tools/tool.js';

function tmpHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'xq-coord-tools-'));
}

function makeContext(sessionId = crypto.randomUUID()): ToolContext {
    return { cwd: '/repo', projectRoot: '/repo', sessionId };
}

afterEach(() => {
    __resetTeamRegistryForTests();
});

// ---------------------------------------------------------------------------
// TeamCreateTool
// ---------------------------------------------------------------------------

describe('TeamCreateTool', () => {
    it('creates a team and returns scratchpad dir', async () => {
        const tool = new TeamCreateTool();
        const result = await tool.execute(
            { toolCallId: 'tc1', team_name: 'alpha', description: 'test team' },
            makeContext(),
        );
        expect(result.success).toBe(true);
        expect(result.output).toContain('alpha');
        expect(result.metadata?.['team']).toBeDefined();
        const scratchpadDir = result.metadata?.['scratchpadDir'] as string;
        expect(fs.existsSync(scratchpadDir)).toBe(true);
    });

    it('fails when team_name is missing', async () => {
        const tool = new TeamCreateTool();
        const result = await tool.execute({ toolCallId: 'tc1' }, makeContext());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/team_name/i);
    });

    it('fails when team already exists', async () => {
        const tool = new TeamCreateTool();
        await tool.execute({ toolCallId: 'tc1', team_name: 'alpha' }, makeContext());
        const result = await tool.execute({ toolCallId: 'tc2', team_name: 'alpha' }, makeContext());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/already exists/i);
    });
});

// ---------------------------------------------------------------------------
// TeamDeleteTool
// ---------------------------------------------------------------------------

describe('TeamDeleteTool', () => {
    it('deletes an existing team', async () => {
        const create = new TeamCreateTool();
        const del = new TeamDeleteTool();
        await create.execute({ toolCallId: 'tc1', team_name: 'beta' }, makeContext());
        const result = await del.execute({ toolCallId: 'tc2', team_name: 'beta' }, makeContext());
        expect(result.success).toBe(true);
        expect(result.output).toContain('beta');
    });

    it('fails when team does not exist', async () => {
        const tool = new TeamDeleteTool();
        const result = await tool.execute({ toolCallId: 'tc1', team_name: 'nobody' }, makeContext());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not found/i);
    });

    it('fails when team_name is missing', async () => {
        const tool = new TeamDeleteTool();
        const result = await tool.execute({ toolCallId: 'tc1' }, makeContext());
        expect(result.success).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// SendMessageTool
// ---------------------------------------------------------------------------

describe('SendMessageTool', () => {
    it('sends a message and returns message id', async () => {
        const tool = new SendMessageTool();
        const result = await tool.execute(
            { toolCallId: 'tc1', to: 'worker-1', content: 'hello' },
            makeContext(),
        );
        expect(result.success).toBe(true);
        expect(result.metadata?.['to']).toBe('worker-1');
        expect(typeof result.metadata?.['messageId']).toBe('string');
    });

    it('fails when to is missing', async () => {
        const tool = new SendMessageTool();
        const result = await tool.execute({ toolCallId: 'tc1', content: 'hi' }, makeContext());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/to is required/i);
    });

    it('fails when content is empty', async () => {
        const tool = new SendMessageTool();
        const result = await tool.execute({ toolCallId: 'tc1', to: 'worker-1', content: '   ' }, makeContext());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/content is required/i);
    });

    it('defaults from to "coordinator"', async () => {
        const tool = new SendMessageTool();
        const result = await tool.execute(
            { toolCallId: 'tc1', to: 'worker-1', content: 'task done' },
            makeContext(),
        );
        expect(result.metadata?.['from']).toBe('coordinator');
    });

    it('uses provided from value', async () => {
        const tool = new SendMessageTool();
        const result = await tool.execute(
            { toolCallId: 'tc1', to: 'coordinator', content: 'done', from: 'worker-1' },
            makeContext(),
        );
        expect(result.metadata?.['from']).toBe('worker-1');
    });
});

// ---------------------------------------------------------------------------
// ReadMailboxTool
// ---------------------------------------------------------------------------

describe('ReadMailboxTool', () => {
    it('reads messages sent to an agent', async () => {
        const send = new SendMessageTool();
        const read = new ReadMailboxTool();
        const ctx = makeContext();

        await send.execute({ toolCallId: 'tc1', to: 'worker-1', content: 'msg1' }, ctx);
        await send.execute({ toolCallId: 'tc2', to: 'worker-1', content: 'msg2' }, ctx);

        const result = await read.execute({ toolCallId: 'tc3', agent_name: 'worker-1' }, ctx);
        expect(result.success).toBe(true);
        const msgs = JSON.parse(result.output);
        expect(msgs).toHaveLength(2);
    });

    it('returns empty array when no messages', async () => {
        const tool = new ReadMailboxTool();
        const result = await tool.execute({ toolCallId: 'tc1', agent_name: 'nobody' }, makeContext());
        expect(result.success).toBe(true);
        expect(JSON.parse(result.output)).toEqual([]);
    });

    it('clears inbox when clear=true', async () => {
        const send = new SendMessageTool();
        const read = new ReadMailboxTool();
        const ctx = makeContext();

        await send.execute({ toolCallId: 'tc1', to: 'worker-1', content: 'hi' }, ctx);
        await read.execute({ toolCallId: 'tc2', agent_name: 'worker-1', clear: true }, ctx);

        const result = await read.execute({ toolCallId: 'tc3', agent_name: 'worker-1' }, ctx);
        expect(JSON.parse(result.output)).toEqual([]);
    });

    it('fails when agent_name is missing', async () => {
        const tool = new ReadMailboxTool();
        const result = await tool.execute({ toolCallId: 'tc1' }, makeContext());
        expect(result.success).toBe(false);
    });
});
