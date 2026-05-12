// P19d — Coordinator tools: TeamCreate / TeamDelete / SendMessage.
//
// These three tools implement the swarm communication layer described in the
// 施工单 §5 Coordinator mode. They front the @xqoder/core-coordinator module
// so the LLM can create named teams, delete them, and send messages between
// agents via the shared scratchpad mailbox.

import * as os from 'node:os';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolContext } from './tool.js';
import {
    clearMailbox,
    ensureScratchpadDir,
    getTeam,
    readMailbox,
    registerTeam,
    unregisterTeam,
    writeToMailbox,
    type TeamEntry,
} from '@xqoder/core-coordinator';

function ok(toolCallId: string, output: string, metadata: Record<string, unknown>): ToolResult {
    return { toolCallId, success: true, output, metadata };
}

function fail(toolCallId: string, error: string): ToolResult {
    return { toolCallId, success: false, output: '', error };
}

function resolveSessionId(context: ToolContext): string {
    return context.sessionId ?? 'default';
}

function resolveHomeDir(): string {
    return os.homedir();
}

// ---------------------------------------------------------------------------
// TeamCreateTool
// ---------------------------------------------------------------------------

export class TeamCreateTool implements ITool {
    isConcurrencySafe(): boolean {
        return false;
    }

    readonly definition: ToolDefinition = {
        name: 'team_create',
        description:
            'Create a named team for coordinator-mode multi-agent work. ' +
            'Returns the team name and scratchpad directory path. ' +
            'Workers communicate via send_message using the team name as the recipient.',
        parameters: [
            {
                name: 'team_name',
                type: 'string',
                description: 'Name for the new team.',
                required: true,
            },
            {
                name: 'description',
                type: 'string',
                description: 'Optional description of the team purpose.',
                required: false,
            },
            {
                name: 'agent_type',
                type: 'string',
                description: 'Optional agent type hint (e.g. "researcher", "test-runner").',
                required: false,
            },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        const teamName = typeof args['team_name'] === 'string' ? args['team_name'].trim() : '';
        if (!teamName) return fail(toolCallId, 'team_name is required');

        if (getTeam(teamName)) {
            return fail(toolCallId, `Team already exists: ${teamName}`);
        }

        const entry: TeamEntry = {
            name: teamName,
            description: typeof args['description'] === 'string' ? args['description'] : undefined,
            agentType: typeof args['agent_type'] === 'string' ? args['agent_type'] : undefined,
            createdAt: new Date().toISOString(),
        };
        registerTeam(entry);

        const sessionId = resolveSessionId(context);
        const scratchpadDir = ensureScratchpadDir(sessionId, resolveHomeDir());

        return ok(
            toolCallId,
            `Team "${teamName}" created. Scratchpad: ${scratchpadDir}`,
            { team: entry, scratchpadDir },
        );
    }
}

// ---------------------------------------------------------------------------
// TeamDeleteTool
// ---------------------------------------------------------------------------

export class TeamDeleteTool implements ITool {
    isConcurrencySafe(): boolean {
        return false;
    }

    readonly definition: ToolDefinition = {
        name: 'team_delete',
        description:
            'Delete a team and clear its mailbox. ' +
            'Use when a team has finished its work and its resources should be released.',
        parameters: [
            {
                name: 'team_name',
                type: 'string',
                description: 'Name of the team to delete.',
                required: true,
            },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        const teamName = typeof args['team_name'] === 'string' ? args['team_name'].trim() : '';
        if (!teamName) return fail(toolCallId, 'team_name is required');

        const team = getTeam(teamName);
        if (!team) return fail(toolCallId, `Team not found: ${teamName}`);

        const sessionId = resolveSessionId(context);
        const scratchpadDir = ensureScratchpadDir(sessionId, resolveHomeDir());
        clearMailbox(scratchpadDir, teamName);
        unregisterTeam(teamName);

        return ok(toolCallId, `Team "${teamName}" deleted.`, { team });
    }
}

// ---------------------------------------------------------------------------
// SendMessageTool
// ---------------------------------------------------------------------------

export class SendMessageTool implements ITool {
    isConcurrencySafe(): boolean {
        return false;
    }

    readonly definition: ToolDefinition = {
        name: 'send_message',
        description:
            'Send a message to a named agent or team via the shared scratchpad mailbox. ' +
            'The recipient polls its inbox JSON file. ' +
            'Use "coordinator" as the recipient to send back to the main session.',
        parameters: [
            {
                name: 'to',
                type: 'string',
                description: 'Recipient name (team name, agent name, or "coordinator").',
                required: true,
            },
            {
                name: 'content',
                type: 'string',
                description: 'Message content.',
                required: true,
            },
            {
                name: 'from',
                type: 'string',
                description: 'Sender name (defaults to "coordinator").',
                required: false,
            },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        const to = typeof args['to'] === 'string' ? args['to'].trim() : '';
        if (!to) return fail(toolCallId, 'to is required');

        const content = typeof args['content'] === 'string' ? args['content'] : '';
        if (!content.trim()) return fail(toolCallId, 'content is required');

        const from = typeof args['from'] === 'string' && args['from'].trim()
            ? args['from'].trim()
            : 'coordinator';

        const sessionId = resolveSessionId(context);
        const scratchpadDir = ensureScratchpadDir(sessionId, resolveHomeDir());

        const msg = writeToMailbox(scratchpadDir, to, from, content);

        return ok(
            toolCallId,
            `Message ${msg.id} sent to "${to}".`,
            { messageId: msg.id, to, from, sentAt: msg.sentAt },
        );
    }
}

// ---------------------------------------------------------------------------
// ReadMailboxTool (bonus: lets workers read their inbox)
// ---------------------------------------------------------------------------

export class ReadMailboxTool implements ITool {
    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return true;
    }

    readonly definition: ToolDefinition = {
        name: 'read_mailbox',
        description:
            'Read pending messages from the scratchpad mailbox for a given agent name. ' +
            'Returns all queued messages and optionally clears the inbox.',
        parameters: [
            {
                name: 'agent_name',
                type: 'string',
                description: 'Agent or team name whose inbox to read.',
                required: true,
            },
            {
                name: 'clear',
                type: 'boolean',
                description: 'If true, clear the inbox after reading (default false).',
                required: false,
            },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        const agentName = typeof args['agent_name'] === 'string' ? args['agent_name'].trim() : '';
        if (!agentName) return fail(toolCallId, 'agent_name is required');

        const sessionId = resolveSessionId(context);
        const scratchpadDir = ensureScratchpadDir(sessionId, resolveHomeDir());

        const messages = readMailbox(scratchpadDir, agentName);

        if (args['clear'] === true) {
            clearMailbox(scratchpadDir, agentName);
        }

        return ok(
            toolCallId,
            JSON.stringify(messages, null, 2),
            { count: messages.length, agentName },
        );
    }
}
