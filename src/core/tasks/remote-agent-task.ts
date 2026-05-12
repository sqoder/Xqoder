// P19d — RemoteAgentTask runner.
//
// Dispatches a task to a remote bridge/daemon over HTTP and streams the
// response to the per-task log file. The transport is injectable so tests
// (and future daemon integration) can swap in their own fetcher without
// standing up a real bridge server.
//
// v1 wire format is intentionally small: POST JSON
//   { taskId, prompt, agent?, metadata? }
// to `metadata.remote.endpoint`, with `Authorization: Bearer <jwt>` when
// `metadata.remote.jwt` is set. Response shape:
//   { finalResponse?, events?: string[], error? }
// The runner writes all response fields to the log and updates the store.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Task } from './task-types.js';
import type { TaskStore } from './task-store.js';

export interface RemoteAgentTaskInput {
    task: Task;
    store: TaskStore;
    cwd: string;
    logDir: string;
    fetcher?: RemoteFetcher;
    /** Max wall-clock time before the runner aborts. Defaults to 10 minutes. */
    timeoutMs?: number;
}

export interface RemoteAgentTaskResult {
    status: 'completed' | 'failed';
    exitCode: 0 | 1;
    logPath: string;
    finalResponse?: string;
}

export interface RemoteFetcherRequest {
    endpoint: string;
    jwt?: string;
    body: {
        taskId: string;
        prompt: string;
        agent?: string;
        metadata?: Record<string, unknown>;
    };
    signal: AbortSignal;
}

export interface RemoteFetcherResponse {
    finalResponse?: string;
    events?: string[];
    error?: string;
}

export type RemoteFetcher = (request: RemoteFetcherRequest) => Promise<RemoteFetcherResponse>;

function resolveRemoteConfig(task: Task): { endpoint: string; jwt?: string; prompt: string; agent?: string } {
    const metadata = (task.metadata ?? {}) as Record<string, unknown>;
    const remote = (metadata['remote'] ?? {}) as Record<string, unknown>;

    const endpoint = typeof remote['endpoint'] === 'string' ? remote['endpoint'].trim() : '';
    if (!endpoint) {
        throw new Error('RemoteAgentTask requires metadata.remote.endpoint');
    }

    const jwt = typeof remote['jwt'] === 'string' && remote['jwt'].length > 0 ? remote['jwt'] : undefined;
    const prompt =
        typeof metadata['prompt'] === 'string' && metadata['prompt'].trim().length > 0
            ? metadata['prompt']
            : task.command ?? task.title;
    const agent =
        typeof metadata['agent'] === 'string' && metadata['agent'].trim().length > 0
            ? metadata['agent']
            : undefined;

    return { endpoint, ...(jwt ? { jwt } : {}), prompt, ...(agent ? { agent } : {}) };
}

export async function runRemoteAgentTask(input: RemoteAgentTaskInput): Promise<RemoteAgentTaskResult> {
    const { task, store, logDir } = input;
    if (task.type !== 'remote-agent') {
        throw new Error(`RemoteAgentTask requires type=remote-agent, got ${task.type}`);
    }

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, `${task.id}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const writeLog = (line: string): void => { logStream.write(`${line}\n`); };

    store.update(task.id, { status: 'running', logPath });

    let resolvedConfig: ReturnType<typeof resolveRemoteConfig>;
    try {
        resolvedConfig = resolveRemoteConfig(task);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeLog(`error: ${message}`);
        await new Promise<void>((resolve) => logStream.end(resolve));
        store.update(task.id, { status: 'failed', exitCode: 1, error: message });
        return { status: 'failed', exitCode: 1, logPath };
    }

    writeLog(`# remote-agent-task ${task.id}`);
    writeLog(`endpoint: ${resolvedConfig.endpoint}`);
    if (resolvedConfig.agent) writeLog(`agent: ${resolvedConfig.agent}`);
    writeLog(`prompt: ${resolvedConfig.prompt}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10 * 60 * 1000);
    timeout.unref?.();

    try {
        const fetcher = input.fetcher ?? defaultRemoteFetcher;
        const body: RemoteFetcherRequest['body'] = {
            taskId: task.id,
            prompt: resolvedConfig.prompt,
            ...(resolvedConfig.agent ? { agent: resolvedConfig.agent } : {}),
            ...(task.metadata ? { metadata: task.metadata } : {}),
        };
        const req: RemoteFetcherRequest = {
            endpoint: resolvedConfig.endpoint,
            ...(resolvedConfig.jwt ? { jwt: resolvedConfig.jwt } : {}),
            body,
            signal: controller.signal,
        };
        const response = await fetcher(req);

        if (response.events) {
            for (const event of response.events) writeLog(`event: ${event}`);
        }
        if (response.error) {
            writeLog(`error: ${response.error}`);
            await new Promise<void>((resolve) => logStream.end(resolve));
            store.update(task.id, { status: 'failed', exitCode: 1, error: response.error });
            return { status: 'failed', exitCode: 1, logPath };
        }

        const finalResponse = response.finalResponse ?? '(no response)';
        writeLog(`response:\n${finalResponse}`);
        await new Promise<void>((resolve) => logStream.end(resolve));
        store.update(task.id, { status: 'completed', exitCode: 0, error: null });
        return {
            status: 'completed',
            exitCode: 0,
            logPath,
            ...(response.finalResponse ? { finalResponse: response.finalResponse } : {}),
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeLog(`error: ${message}`);
        await new Promise<void>((resolve) => logStream.end(resolve));
        store.update(task.id, { status: 'failed', exitCode: 1, error: message });
        return { status: 'failed', exitCode: 1, logPath };
    } finally {
        clearTimeout(timeout);
    }
}

async function defaultRemoteFetcher(request: RemoteFetcherRequest): Promise<RemoteFetcherResponse> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (request.jwt) headers['Authorization'] = `Bearer ${request.jwt}`;

    const res = await fetch(request.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(request.body),
        signal: request.signal,
    });
    const text = await res.text();
    if (!res.ok) {
        return { error: `remote endpoint returned ${res.status}: ${text.slice(0, 200)}` };
    }
    try {
        return JSON.parse(text) as RemoteFetcherResponse;
    } catch {
        return { finalResponse: text };
    }
}
