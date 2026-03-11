/**
 * Agent event processing module - pure functions for handling agent events.
 * Extracted from app.tsx to match OpenCode's event-driven architecture.
 */

import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { AgentEvent } from './agent-service.js';
import type { ChatMessage } from './message.js';
import type { ToolExecution, FileChange } from './layout.js';

export interface AgentEventState {
    messages: ChatMessage[];
    toolExecutions: ToolExecution[];
    fileChanges: FileChange[];
    expandedToolIds: string[];
    infoMessage: string;
    assistantMsgId: string;
    accumulatedContent: string;
    pendingFileSnapshots: Map<string, string | null>;
}

export interface AgentEventResult {
    messages?: ChatMessage[];
    toolExecutions?: ToolExecution[];
    fileChanges?: FileChange[];
    expandedToolIds?: string[];
    infoMessage?: string;
    assistantMsgId?: string;
    accumulatedContent?: string;
    systemMessageToAdd?: string;
    pendingFileSnapshots?: Map<string, string | null>;
}

export interface ProcessEventOptions {
    state: AgentEventState;
    event: AgentEvent;
    showToolDetails: boolean;
    msgIdCounter: number;
}

export interface TokenFlushState {
    pendingTokenContent: string | null;
    pendingTokenMsgId: string | null;
    tokenFlushTimer: ReturnType<typeof setTimeout> | null;
}

const TOKEN_FLUSH_INTERVAL = 120;

const FILE_MOD_TOOLS = ['edit', 'write', 'patch', 'str_replace'];
const MAX_TOOL_EXECUTIONS = 50;
const MAX_FILE_CHANGES = 30;
const MAX_MESSAGES = 200;
const RECENT_DISPLAY_COUNT = 6;

const ANSI_ESCAPE_RE = /[\u001b\u009b][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><])/g;

export function sanitizeDisplayText(content: string): string {
    const withoutAnsi = content.replace(ANSI_ESCAPE_RE, '');
    const withoutEmoji = withoutAnsi.replace(/\p{Extended_Pictographic}/gu, '');
    return withoutEmoji
        .split('\n')
        .map(line => line.replace(/[ \t]{2,}/g, ' ').trimEnd())
        .join('\n');
}

export function createInitialAssistantMessage(msgIdCounter: number): ChatMessage {
    return {
        id: `msg-${msgIdCounter}-${Date.now()}`,
        timestamp: new Date(),
        type: 'assistant',
        content: 'Thinking...',
        isStreaming: true,
    };
}

export function updateAssistantMessageInState(
    messages: ChatMessage[],
    assistantMsgId: string,
    content: string,
    isStreaming: boolean,
): ChatMessage[] {
    return messages.map(m =>
        m.id === assistantMsgId
            ? { ...m, content: sanitizeDisplayText(content), isStreaming }
            : m,
    );
}

export function processTokenEvent(
    accumulatedContent: string,
    event: Extract<AgentEvent, { type: 'token' }>,
): string {
    return accumulatedContent + event.content;
}

export function processToolStartEvent(
    toolExecutions: ToolExecution[],
    event: Extract<AgentEvent, { type: 'tool_start' }>,
    pendingFileSnapshots: Map<string, string | null>,
): { toolExecutions: ToolExecution[]; snapshot: Map<string, string | null>; newToolId: string } {
    const execId = `tool-${Date.now()}-${event.name}`;
    const next = [...toolExecutions, {
        id: execId,
        name: event.name,
        args: event.args ?? {},
        startedAt: new Date(),
    }];

    const capped = next.length > MAX_TOOL_EXECUTIONS ? next.slice(-MAX_TOOL_EXECUTIONS) : next;

    const newSnapshot = new Map(pendingFileSnapshots);

    if (FILE_MOD_TOOLS.includes(event.name)) {
        const filePath = (event.args as Record<string, unknown>)?.file_path
            ?? (event.args as Record<string, unknown>)?.path;
        if (typeof filePath === 'string') {
            try {
                const before = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
                newSnapshot.set(filePath, before);
            } catch { /* ignore */ }
        }
    }

    return {
        toolExecutions: capped,
        snapshot: newSnapshot,
        newToolId: execId,
    };
}

export function processToolEndEvent(
    toolExecutions: ToolExecution[],
    fileChanges: FileChange[],
    event: Extract<AgentEvent, { type: 'tool_end' }>,
    pendingFileSnapshots: Map<string, string | null>,
    messages: ChatMessage[],
    assistantMsgId: string,
): {
    toolExecutions: ToolExecution[];
    fileChanges: FileChange[];
    messages: ChatMessage[];
    infoMessage: string;
    systemMessage: string | null;
    compactSummary: string | null;
} {
    let updatedExecutions = [...toolExecutions];
    let updatedFileChanges = [...fileChanges];
    let updatedMessages = [...messages];
    let systemMessage: string | null = null;
    let compactSummary: string | null = null;
    let infoMessage = 'Thinking...';

    // Handle auto_compact
    if (event.name === 'auto_compact' && event.success && event.result) {
        compactSummary = event.result;
        const keep = updatedMessages.slice(-RECENT_DISPLAY_COUNT);
        const compactBlock: ChatMessage = {
            id: `compact-${Date.now()}`,
            type: 'system',
            content: `Earlier conversation (compressed):\n\n${event.result}`,
        };
        updatedMessages = [compactBlock, ...keep];
        infoMessage = 'Context compressed';
    }

    // Update tool execution
    let idx = -1;
    for (let i = updatedExecutions.length - 1; i >= 0; i--) {
        if (updatedExecutions[i]!.name === event.name && !updatedExecutions[i]!.endedAt) {
            idx = i;
            break;
        }
    }
    if (idx !== -1) {
        updatedExecutions[idx] = { ...updatedExecutions[idx]!, endedAt: new Date(), success: event.success };
    }

    // Process file changes
    if (FILE_MOD_TOOLS.includes(event.name) && event.success) {
        for (const [fp, before] of pendingFileSnapshots.entries()) {
            try {
                const after = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : null;
                if (before !== after) {
                    const next = [...updatedFileChanges, {
                        filePath: fp,
                        before,
                        after,
                        toolName: event.name,
                        timestamp: new Date(),
                    }];
                    updatedFileChanges = next.length > MAX_FILE_CHANGES ? next.slice(-MAX_FILE_CHANGES) : next;
                }
            } catch { /* ignore */ }
        }
    }

    return {
        toolExecutions: updatedExecutions,
        fileChanges: updatedFileChanges,
        messages: updatedMessages,
        infoMessage,
        systemMessage,
        compactSummary,
    };
}

export function processCompleteEvent(
    messages: ChatMessage[],
    assistantMsgId: string,
    accumulatedContent: string,
): ChatMessage[] {
    return updateAssistantMessageInState(messages, assistantMsgId, accumulatedContent, false);
}

export function processErrorEvent(
    messages: ChatMessage[],
    assistantMsgId: string,
    accumulatedContent: string,
    event: Extract<AgentEvent, { type: 'error' }>,
): { messages: ChatMessage[]; systemMessage: string } {
    const updated = updateAssistantMessageInState(messages, assistantMsgId, accumulatedContent || '(error)', false);
    const errorMessage = 'error' in event ? event.error.message : event.message;
    return {
        messages: updated,
        systemMessage: `Error: ${errorMessage}`,
    };
}

export function addMessageToState(
    messages: ChatMessage[],
    partial: Omit<ChatMessage, 'id' | 'timestamp'>,
    msgIdCounter: number,
): { messages: ChatMessage[]; newMsgId: string } {
    const sanitizedContent = partial.type === 'user'
        ? partial.content
        : sanitizeDisplayText(partial.content);

    const newMsgId = `msg-${msgIdCounter}-${Date.now()}`;
    const msg: ChatMessage = {
        id: newMsgId,
        timestamp: new Date(),
        ...partial,
        content: sanitizedContent,
    };

    const next = [...messages, msg];
    return {
        messages: next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next,
        newMsgId,
    };
}

export function buildToolStartSystemMessage(
    event: Extract<AgentEvent, { type: 'tool_start' }>,
): string {
    const argsPreview = JSON.stringify(event.args).slice(0, 100);
    return `tool: ${event.name}(${argsPreview})`;
}

export function buildToolEndSystemMessage(
    event: Extract<AgentEvent, { type: 'tool_end' }>,
): string {
    return `${event.name}: ${event.success ? 'ok' : 'failed'}`;
}

export function getInitialEventState(assistantMsgId: string): AgentEventState {
    return {
        messages: [],
        toolExecutions: [],
        fileChanges: [],
        expandedToolIds: [],
        infoMessage: 'Thinking...',
        assistantMsgId,
        accumulatedContent: '',
        pendingFileSnapshots: new Map(),
    };
}

export function copyToClipboard(text: string): boolean {
    const cmd = process.platform === 'darwin' ? 'pbcopy'
        : (process.env.DISPLAY ? 'xclip' : undefined);
    if (!cmd) return false;
    try {
        spawnSync(cmd, [], { input: text, encoding: 'utf8' });
        return true;
    } catch {
        return false;
    }
}
