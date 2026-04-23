import type { Server as HttpServer } from 'node:http';
import { Command } from 'commander';
import {
    configManager,
    getXQoderPaths,
    resolveConfigWithEnvOverrides,
    type XQoderConfig,
} from '@xqoder/shared';
import type { ConversationEventEnvelope } from '@xqoder/protocol';
import type { QuestionAnswer, QuestionPrompt } from '@xqoder/plugin-sdk';
import {
    SQLiteSessionStore,
    type AgentSessionStore,
} from '@xqoder/storage-sqlite';
import {
    assertServeDirectoryWritable,
    resolveServeRuntimeOptions,
    type ServeCommandOptions,
    type ServeRuntimeOptions,
} from '../../application/remote/serve-runtime.js';
import {
    type AgentConversationPort,
    type AgentQuestionRequest,
    type TuiAgentSettings,
} from '../../application/agent/index.js';
import { TuiAgentService } from '../../infrastructure/agent/index.js';
import {
    createServer as createHttpServer,
    type ServerOptions,
} from '../../interfaces/http/index.js';

type ServeCliOptions = Partial<ServeCommandOptions> & {
    host?: string;
};

type ServeAgentService = Pick<AgentConversationPort, 'cancel' | 'dispose' | 'sendMessage'>;
type ConfigLoader = {
    load(options?: { cwd?: string; env?: NodeJS.ProcessEnv }): XQoderConfig;
};

export interface ServeCommandDependencies {
    configLoader?: ConfigLoader;
    createAgentService?: (sessionStore: AgentSessionStore) => ServeAgentService;
    createServer?: (options: ServerOptions) => HttpServer;
    createSessionStore?: (dbPath: string) => AgentSessionStore;
    env?: NodeJS.ProcessEnv;
    registerSignalHandlers?: boolean;
    writeOutput?: (message: string) => void;
}

export interface ServeCommandRuntime {
    agentService: ServeAgentService;
    options: ServeRuntimeOptions;
    server: HttpServer;
    sessionStore: AgentSessionStore;
}

export function createServeCommand(dependencies: ServeCommandDependencies = {}): Command {
    return new Command('serve')
        .alias('remote-control')
        .description('Start a local HTTP server for XQoder sessions')
        .option('-d, --dir <dir>', 'Project directory to serve', '.')
        .option('-p, --port <number>', 'Port to listen on')
        .option('--hostname <host>', 'Host to bind to')
        .option('--host <host>', 'Alias for --hostname')
        .option('--cors <origins>', 'Comma-separated allowed CORS origins')
        .action(async (options: ServeCliOptions) => {
            await runServeCommand(options, dependencies);
        });
}

export async function runServeCommand(
    options: ServeCliOptions,
    dependencies: ServeCommandDependencies = {},
): Promise<ServeCommandRuntime> {
    const env = dependencies.env ?? process.env;
    const normalizedOptions = normalizeServeOptions(options);
    const configLoader = dependencies.configLoader ?? configManager;
    const loadedConfig = configLoader.load({
        cwd: normalizedOptions.dir,
        env,
    });
    const { config } = resolveConfigWithEnvOverrides(loadedConfig, env);
    const runtimeOptions = resolveServeRuntimeOptions(
        normalizedOptions,
        config.server,
        env,
    );

    assertServeDirectoryWritable(runtimeOptions.cwd);

    const sessionStore = (dependencies.createSessionStore ?? defaultCreateSessionStore)(
        getXQoderPaths().sessionDbFile,
    );
    const agentService = (dependencies.createAgentService ?? defaultCreateAgentService)(sessionStore);
    const serverFactory = dependencies.createServer ?? createHttpServer;

    const server = serverFactory({
        port: runtimeOptions.port,
        hostname: runtimeOptions.hostname,
        cors: runtimeOptions.cors,
        password: runtimeOptions.password,
        username: runtimeOptions.username,
        cwd: runtimeOptions.cwd,
        defaultModel: config.llm.model,
        sessionStore,
        runMessage: createRunMessage(agentService, config),
        runMessageStream: createRunMessageStream(agentService, config),
    });

    const runtime: ServeCommandRuntime = {
        agentService,
        options: runtimeOptions,
        server,
        sessionStore,
    };

    if (dependencies.registerSignalHandlers !== false) {
        installSignalHandlers(runtime, dependencies.writeOutput ?? console.log);
    }

    const writeOutput = dependencies.writeOutput ?? console.log;
    writeOutput(`[XQoder] Serve listening on http://${runtimeOptions.hostname}:${runtimeOptions.port}`);
    writeOutput(`[XQoder] Project root: ${runtimeOptions.cwd}`);
    if (runtimeOptions.password) {
        writeOutput(`[XQoder] Basic auth enabled for user ${runtimeOptions.username}`);
    }

    return runtime;
}

function defaultCreateSessionStore(dbPath: string): AgentSessionStore {
    return new SQLiteSessionStore(dbPath);
}

function defaultCreateAgentService(sessionStore: AgentSessionStore): ServeAgentService {
    return new TuiAgentService(sessionStore);
}

function normalizeServeOptions(options: ServeCliOptions): ServeCommandOptions {
    const hostname = options.hostname ?? options.host;

    return {
        dir: options.dir ?? '.',
        ...(options.port ? { port: options.port } : {}),
        ...(hostname ? { hostname } : {}),
        ...(options.cors ? { cors: options.cors } : {}),
        ...(options.mdns !== undefined ? { mdns: options.mdns } : {}),
    };
}

function createRunMessage(
    agentService: ServeAgentService,
    config: XQoderConfig,
): NonNullable<ServerOptions['runMessage']> {
    return async (params) => {
        const response = { value: '' };
        const result = await agentService.sendMessage(
            params.message,
            params.sessionId,
            createAgentSettings(params.projectRoot, config),
            params.attachments ?? [],
            {
                onEvent: (event) => collectAssistantResponse(event, response),
                onQuestion: answerQuestionWithEmptySelection,
                onToolApproval: async () => false,
            },
        );

        return {
            response: response.value,
            sessionId: result.sessionId,
        };
    };
}

function createRunMessageStream(
    agentService: ServeAgentService,
    config: XQoderConfig,
): NonNullable<ServerOptions['runMessageStream']> {
    return async (params) => {
        throwIfAborted(params.signal);
        const response = { value: '' };
        const abortHandler = () => {
            agentService.cancel();
        };
        params.signal?.addEventListener('abort', abortHandler, { once: true });

        try {
            const result = await agentService.sendMessage(
                params.message,
                params.sessionId,
                createAgentSettings(params.projectRoot, config),
                params.attachments ?? [],
                {
                    onEvent: (event) => {
                        collectAssistantResponse(event, response);
                        params.onEvent(event);
                    },
                    onQuestion: (request) => params.requestQuestion(toQuestionPrompt(request)),
                    onToolApproval: async () => false,
                },
            );

            throwIfAborted(params.signal);

            return {
                response: response.value,
                sessionId: result.sessionId,
            };
        } finally {
            params.signal?.removeEventListener('abort', abortHandler);
        }
    };
}

function createAgentSettings(projectRoot: string, config: XQoderConfig): TuiAgentSettings {
    return {
        dir: projectRoot,
        model: config.llm.model,
        agent: config.defaultAgent ?? 'general',
        sandboxMode: config.sandbox?.mode ?? 'project',
    };
}

function collectAssistantResponse(
    event: ConversationEventEnvelope,
    response: { value: string },
): void {
    if (event.type === 'message.delta' && event.payload.role === 'assistant') {
        response.value += event.payload.text;
        return;
    }

    if (event.type === 'message.completed' && event.payload.message.role === 'assistant') {
        response.value = event.payload.message.content;
    }
}

function toQuestionPrompt(request: AgentQuestionRequest): QuestionPrompt {
    return {
        requestId: request.requestId,
        question: request.question,
        options: request.options.map((option) => ({
            label: option.label,
            ...(option.description ? { description: option.description } : {}),
        })),
        ...(request.header ? { header: request.header } : {}),
        ...(request.multiple !== undefined ? { multiple: request.multiple } : {}),
        ...(request.allowCustom !== undefined ? { allowCustom: request.allowCustom } : {}),
    };
}

function answerQuestionWithEmptySelection(request: AgentQuestionRequest): Promise<QuestionAnswer> {
    return Promise.resolve({
        requestId: request.requestId,
        selected: [],
    });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) {
        return;
    }
    const reason = signal.reason;
    throw reason instanceof Error ? reason : new Error('Request aborted');
}

function installSignalHandlers(
    runtime: ServeCommandRuntime,
    writeOutput: (message: string) => void,
): void {
    const shutdown = (signal: NodeJS.Signals) => {
        writeOutput(`[XQoder] Received ${signal}; shutting down serve.`);
        runtime.agentService.cancel();
        runtime.server.close(() => {
            void cleanupRuntime(runtime).finally(() => {
                process.exit(0);
            });
        });
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

async function cleanupRuntime(runtime: ServeCommandRuntime): Promise<void> {
    try {
        await runtime.agentService.dispose();
    } finally {
        runtime.sessionStore.close();
    }
}
