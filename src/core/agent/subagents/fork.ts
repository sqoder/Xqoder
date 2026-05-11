// P16b — forkSubagent fork spec + runner.
//
// A fork is a scoped subagent run. Given a `ForkSpec` and the parent's
// state, we:
//   1. Build a new system prompt that prepends the subagent's role prompt
//      to the parent's base system prompt (so project memory / CLAUDE.md
//      stays in effect).
//   2. Clone the parent's readFileState so the child does not re-read
//      files the parent already has cached.
//   3. Run the child conversation via an injected runner (which in P16c
//      wraps `runConversationTurn`).
//   4. Snapshot the child's memory and return the memory snapshot + the
//      final assistant content for the parent.
//
// This module is pure w.r.t. real sessions / providers: both the child
// session factory and the conversation runner are injected. P16c wires
// them to the real AgentSession / runConversationTurn; tests pass stubs.

import type { LLMMessage } from '@xqoder/shared';
import type { BuiltInAgent } from './built-in.js';
import {
    snapshotSubagentMemory,
    type AgentMemorySnapshot,
    type ForkableSessionView,
} from './memory.js';

export interface ForkSpec {
    readonly agent: BuiltInAgent;
    /** User-level message that triggers the fork. */
    readonly task: string;
    /** Optional extra instructions appended after the subagent's system prompt. */
    readonly extraSystem?: string;
    /** Per-fork abort signal. Parent should forward its signal when the parent is cancelled. */
    readonly signal?: AbortSignal;
    /** Tool pool restriction. The caller (P16c) computes this from the agent's allowedTools. */
    readonly toolNames: readonly string[];
}

/**
 * Narrow interface used by forkSubagent. Carries the pieces of the
 * parent's state the child needs to inherit.
 */
export interface ParentForkContext {
    readonly baseSystemPrompt?: string;
    readonly readFiles: readonly string[];
}

export interface ForkableChildSession extends ForkableSessionView {
    setSystemPrompt(systemPrompt: string): void;
    addUserMessage(content: string): void;
    /** Hydrate the child's read-file tracker from the parent's clone. */
    hydrateReadFiles?(files: readonly string[]): void;
}

/** Signature of the child conversation runner (P16c wraps runConversationTurn). */
export type ForkChildRunner = (
    session: ForkableChildSession,
    spec: ForkSpec,
) => Promise<void>;

export interface ForkSubagentDependencies {
    readonly createChildSession: (spec: ForkSpec) => ForkableChildSession;
    readonly runChild: ForkChildRunner;
}

export interface ForkResult {
    readonly snapshot: AgentMemorySnapshot;
    readonly agentName: string;
}

export async function forkSubagent(
    parent: ParentForkContext,
    spec: ForkSpec,
    deps: ForkSubagentDependencies,
): Promise<ForkResult> {
    const child = deps.createChildSession(spec);
    child.setSystemPrompt(buildSubagentSystemPrompt(parent, spec));
    child.hydrateReadFiles?.(parent.readFiles);
    child.addUserMessage(spec.task);
    await deps.runChild(child, spec);
    return {
        snapshot: snapshotSubagentMemory(child),
        agentName: spec.agent.name,
    };
}

export function buildSubagentSystemPrompt(
    parent: ParentForkContext,
    spec: ForkSpec,
): string {
    const parts: string[] = [];
    parts.push(spec.agent.systemPrompt);
    if (parent.baseSystemPrompt && parent.baseSystemPrompt.trim().length > 0) {
        parts.push('Parent context:\n' + parent.baseSystemPrompt.trim());
    }
    if (spec.extraSystem && spec.extraSystem.trim().length > 0) {
        parts.push(spec.extraSystem.trim());
    }
    return parts.join('\n\n');
}

/**
 * Helper for tests and P16c: validate that a tool pool respects the
 * subagent's allowedTools whitelist.
 */
export function assertToolsAllowed(
    tools: readonly string[],
    agent: BuiltInAgent,
): void {
    if (agent.allowedTools.length === 1 && agent.allowedTools[0] === '*') return;
    for (const tool of tools) {
        const matches = agent.allowedTools.some((pattern) => {
            if (pattern.endsWith('*')) return tool.startsWith(pattern.slice(0, -1));
            return tool === pattern;
        });
        if (!matches) {
            throw new Error(
                `tool ${tool} not in allowedTools for subagent ${agent.name}`,
            );
        }
    }
}

/**
 * Stable ordering helper — callers sometimes want to pick the "primary"
 * assistant message out of a messages array when the conversation ended
 * with a tool use. Exposed for P16c in case the AgentTool wants to
 * special-case that path.
 */
export function findFinalAssistantContent(messages: readonly LLMMessage[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (m && m.role === 'assistant' && m.content.trim().length > 0) {
            return m.content.trim();
        }
    }
    return undefined;
}
