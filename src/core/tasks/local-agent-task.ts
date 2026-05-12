// P19d — LocalAgentTask runner.
//
// Runs a subagent in-process by forkSubagent + an InMemoryChildSession. This
// is the task-layer entry point that the task-runner dispatches `type=agent`
// tasks to; the agent runs without a ToolContext (no tool calls), just an
// LLM text loop. Transcripts are persisted to the per-task log file, and the
// store row is updated on start/finish.
//
// Deps are injected so tests can run without touching a real LLM provider.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LLMMessage, LLMProviderConfig } from '@xqoder/shared';
import type { ILLMProvider } from '../../shared/llm-api/base.js';
import { createLLMProvider } from '../agent/index.js';
import {
    forkSubagent,
    getBuiltInAgent,
    type AgentMemoryNote,
    type AgentMemoryUsage,
    type BuiltInAgent,
    type ForkChildRunner,
    type ForkResult,
    type ForkSpec,
    type ForkableChildSession,
    type ParentForkContext,
} from '../agent/subagents/index.js';
import type { Task } from './task-types.js';
import type { TaskStore } from './task-store.js';

export interface LocalAgentTaskInput {
    task: Task;
    store: TaskStore;
    cwd: string;
    logDir: string;
    llmConfig?: LLMProviderConfig;
    providerFactory?: (config: LLMProviderConfig) => Promise<ILLMProvider> | ILLMProvider;
    runChild?: ForkChildRunner;
    /** When set, skip provider creation entirely — used for tests. */
    runnerOverride?: ForkChildRunner;
}

export interface LocalAgentTaskResult {
    status: 'completed' | 'failed';
    exitCode: 0 | 1;
    logPath: string;
    finalResponse?: string;
}

const FALLBACK_AGENT: BuiltInAgent = {
    name: 'general-purpose',
    description: 'General-purpose subagent with full toolbelt',
    systemPrompt:
        'You are a general-purpose subagent. Complete the delegated task, report back, stop.',
    allowedTools: ['*'],
    concurrencySafe: false,
    color: 'yellow',
};

class InMemoryChildSession implements ForkableChildSession {
    private _messages: LLMMessage[] = [];
    private _usage: AgentMemoryUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    private _readFiles: string[] = [];
    private _writtenNotes: AgentMemoryNote[] = [];

    setSystemPrompt(systemPrompt: string): void {
        this._messages = [{ role: 'system', content: systemPrompt }];
    }
    addUserMessage(content: string): void {
        this._messages.push({ role: 'user', content });
    }
    hydrateReadFiles(files: readonly string[]): void {
        this._readFiles = [...files];
    }
    getMessages(): readonly LLMMessage[] { return this._messages; }
    getUsage(): AgentMemoryUsage { return this._usage; }
    getReadFiles(): readonly string[] { return this._readFiles; }
    getWrittenNotes(): readonly AgentMemoryNote[] { return this._writtenNotes; }

    pushMessage(msg: LLMMessage): void { this._messages.push(msg); }
    addUsage(u: AgentMemoryUsage): void {
        this._usage = {
            promptTokens: this._usage.promptTokens + u.promptTokens,
            completionTokens: this._usage.completionTokens + u.completionTokens,
            totalTokens: this._usage.totalTokens + u.totalTokens,
        };
    }
}

/**
 * Default runChild implementation: single LLM round-trip, no tools.
 * Good enough for the "run a background subagent question" use case; tasks
 * that need tools should spawn a DelegateTaskTool from inside an interactive
 * session instead.
 */
function buildDefaultRunChild(provider: ILLMProvider): ForkChildRunner {
    return async (session: ForkableChildSession): Promise<void> => {
        const child = session as InMemoryChildSession;
        const response = await provider.complete({
            messages: [...child.getMessages()],
            maxTokens: 2048,
            temperature: 0.2,
        });
        child.addUsage(response.usage);
        child.pushMessage({ role: 'assistant', content: response.message.content });
    };
}

function resolveAgentAndPrompt(task: Task): { agent: BuiltInAgent; prompt: string } {
    const metadata = (task.metadata ?? {}) as Record<string, unknown>;
    const agentName =
        typeof metadata['agent'] === 'string' && metadata['agent'].trim().length > 0
            ? metadata['agent'].trim()
            : 'general-purpose';
    const agent = getBuiltInAgent(agentName) ?? { ...FALLBACK_AGENT, name: agentName };
    const prompt =
        typeof metadata['prompt'] === 'string' && metadata['prompt'].trim().length > 0
            ? metadata['prompt']
            : task.command ?? task.title;
    return { agent, prompt };
}

export async function runLocalAgentTask(input: LocalAgentTaskInput): Promise<LocalAgentTaskResult> {
    const { task, store, logDir } = input;
    if (task.type !== 'agent') {
        throw new Error(`LocalAgentTask requires type=agent, got ${task.type}`);
    }

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, `${task.id}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const writeLog = (line: string): void => { logStream.write(`${line}\n`); };

    store.update(task.id, { status: 'running', logPath });

    const { agent, prompt } = resolveAgentAndPrompt(task);
    writeLog(`# local-agent-task ${task.id}`);
    writeLog(`agent: ${agent.name}`);
    writeLog(`prompt: ${prompt}`);

    try {
        let runChild = input.runnerOverride ?? input.runChild;
        if (!runChild) {
            const factory = input.providerFactory ?? createLLMProvider;
            if (!input.llmConfig) {
                throw new Error('LocalAgentTask requires llmConfig when runChild is not injected');
            }
            const provider = await factory(input.llmConfig);
            runChild = buildDefaultRunChild(provider);
        }

        const spec: ForkSpec = { agent, task: prompt, toolNames: [] };
        const parent: ParentForkContext = { readFiles: [] };
        const createChildSession = (_spec: ForkSpec): ForkableChildSession => new InMemoryChildSession();
        const result: ForkResult = await forkSubagent(parent, spec, {
            createChildSession,
            runChild,
        });

        const finalResponse = result.snapshot.finalResponse ?? '(no response)';
        writeLog(`response:\n${finalResponse}`);
        writeLog(`usage: prompt=${result.snapshot.usage.promptTokens} completion=${result.snapshot.usage.completionTokens} total=${result.snapshot.usage.totalTokens}`);

        await new Promise<void>((resolve) => logStream.end(resolve));
        store.update(task.id, { status: 'completed', exitCode: 0, error: null });
        return {
            status: 'completed',
            exitCode: 0,
            logPath,
            ...(result.snapshot.finalResponse ? { finalResponse: result.snapshot.finalResponse } : {}),
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeLog(`error: ${message}`);
        await new Promise<void>((resolve) => logStream.end(resolve));
        store.update(task.id, { status: 'failed', exitCode: 1, error: message });
        return { status: 'failed', exitCode: 1, logPath };
    }
}
