/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageAttachment } from '@xqoder/shared';

export type WithMeta = { _meta?: Record<string, unknown> };

export type Unsubscribe = () => void;

/**
 * AgentProtocol defines the interface for interacting with an Agent session.
 * Heavily inspired by Gemini CLI's AgentProtocol for interoperability and clean UI separation.
 */
export interface AgentProtocol {
    /**
     * Send data to the agent. Promise resolves when action is acknowledged.
     * Returns a streamId that correlates all events emitted as a result of this send.
     */
    send(payload: AgentSend): Promise<{ streamId: string | null }>;

    /**
     * Subscribes to all future events emitted by this session.
     */
    subscribe(callback: (event: AgentEvent) => void): Unsubscribe;

    /**
     * Aborts an active stream of agent activity.
     */
    abort(): Promise<void>;

    /**
     * The history of all events emitted in this session.
     */
    readonly events: readonly AgentEvent[];
}

type RequireExactlyOne<T> = {
    [K in keyof T]: Required<Pick<T, K>> &
    Partial<Record<Exclude<keyof T, K>, never>>;
}[keyof T];

interface AgentSendPayloads {
    message: {
        content: string;
        attachments?: MessageAttachment[];
    };
    elicitation_response: {
        requestId: string;
        action: 'accept' | 'decline' | 'cancel';
        content: Record<string, unknown>;
    };
    update: { title?: string; model?: string; config?: Record<string, unknown> };
}

export type AgentSend = RequireExactlyOne<AgentSendPayloads> & WithMeta;

export interface AgentEventCommon {
    id: string;
    streamId: string;
    timestamp: string;
    type: string;
    _meta?: Record<string, unknown>;
}

export type AgentEvent<
    EventType extends keyof AgentEvents = keyof AgentEvents,
> = {
    [K in EventType]: AgentEventCommon & AgentEvents[K] & { type: K };
}[EventType];

export type AgentEventType = keyof AgentEvents;

export interface AgentEvents {
    initialize: Initialize;
    session_update: SessionUpdate;
    message: Message;
    thought: Thought;
    agent_start: AgentStart;
    agent_end: AgentEnd;
    tool_request: ToolRequest;
    tool_update: ToolUpdate;
    tool_response: ToolResponse;
    usage: Usage;
    error: ErrorData;
}

export interface Initialize {
    sessionId: string;
    workspace: string;
    agentId: string;
    config?: Record<string, unknown>;
}

export interface SessionUpdate {
    title?: string;
    model?: string;
    config?: Record<string, unknown>;
}

export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface Thought {
    content: string;
}

export interface AgentStart {
    streamId: string;
}

export interface AgentEnd {
    streamId: string;
    reason: 'completed' | 'failed' | 'aborted' | 'error';
    summary?: string;
}

export interface ToolRequest {
    requestId: string;
    name: string;
    args: Record<string, unknown>;
}

export interface ToolUpdate {
    requestId: string;
    chunk?: string;
    stream?: 'stdout' | 'stderr';
    progress?: number;
    message?: string;
}

export interface ToolResponse {
    requestId: string;
    name: string;
    output: string;
    success: boolean;
}

export interface Usage {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
}

export interface ErrorData {
    message: string;
    fatal: boolean;
    code?: string;
}
