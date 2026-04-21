import * as path from 'node:path';
import {
    ConfigManager,
    configManager,
    resolveDefaultAgentName,
    resolveConfigWithEnvOverrides,
    formatOutput,
    createSpinner,
    type MessageAttachment,
    type OutputFormat,
} from '@xqoder/shared';
import {
    resolveRuntimeDecision,
} from '@xqoder/core-runtime';
import {
    AgentSession,
    XQoderAgent,
    buildAgentConfigFromXQoderConfig,
    type AgentCallbacks,
} from '@xqoder/agent';
import { MISSING_API_KEY_GUIDANCE } from '../config/api-key-guidance.js';
import { llmProviderRequiresApiKey } from '../config/api-key-guidance.js';
import type {
    ChatAgentFactoryConfig,
    ChatAgentInstance,
    ChatSessionStore,
} from './ports.js';
import {
    buildChatPromptAppendixFromRoute,
    maybeAugmentPromptWithProjectContextFromRoute,
    resolveChatRuntimeIdentity,
} from './prompt-composer.js';
import { resolveChatInteraction } from './interaction-router.js';
import { buildLocalFallbackGuidance, type LocalFallbackInput } from '../../shared/local-fallback.js';
import {
    buildInstructionAppendix,
    resolveInstructionSet,
} from '../instructions/index.js';
export {
    buildAutoProjectContext,
    buildChatPromptAppendix,
    buildChatSystemPrompt,
    maybeAugmentPromptWithProjectContext,
    resolveChatRuntimeIdentity,
    shouldUseStructuredEngineeringResponse,
    type ChatRuntimeIdentity,
    type ChatSystemPromptOptions,
} from './prompt-composer.js';

export interface ChatRunOptions {
    dir: string;
    model?: string;
    agent?: string;
    session?: string;
    newSession?: boolean;
    format?: OutputFormat;
    attachments?: MessageAttachment[];
}

export interface ChatServiceDependencies {
    configManager?: Pick<ConfigManager, 'load'>;
    sessionStore?: ChatSessionStore;
    createSessionStore?: () => ChatSessionStore | undefined;
    agentFactory?: (config: ChatAgentFactoryConfig) => ChatAgentInstance;
    localFallbackAdvisor?: (input: LocalFallbackInput) => Promise<string | undefined>;
}

export interface NonInteractivePromptOptions {
    prompt: string;
    cwd: string;
    outputFormat: OutputFormat;
    quiet: boolean;
    model?: string;
    agent?: string;
    resume?: string;
    continue?: boolean;
    forkSession?: boolean;
    permissionMode?: string;
    effort?: string;
    maxTurns?: number;
    noSessionPersistence?: boolean;
}

function resolveChatSession(
    sessionStore: Pick<ChatSessionStore, 'findLatestSession' | 'getSession'> | undefined,
    options: {
        projectRoot: string;
        sessionId?: string;
        newSession: boolean;
    },
): AgentSession | undefined {
    if (!sessionStore || options.newSession) {
        return undefined;
    }
    if (options.sessionId) {
        const explicitSession = sessionStore.getSession(options.sessionId);
        if (!explicitSession) {
            throw new Error(`Specified session not found: ${options.sessionId}`);
        }
        return explicitSession;
    }
    return sessionStore.findLatestSession(options.projectRoot) ?? undefined;
}

export async function runChatHeadless(
    prompt: string,
    options: ChatRunOptions,
    dependencies: ChatServiceDependencies = {},
): Promise<{ response: string; sessionId: string }> {
    const resolvedDir = path.resolve(options.dir);
    const interaction = resolveChatInteraction(prompt);
    const runtimeDecision = resolveRuntimeDecision(interaction);
    const preparedPrompt = runtimeDecision.shouldAugmentProjectContext
        ? maybeAugmentPromptWithProjectContextFromRoute(prompt, resolvedDir, interaction)
        : prompt;
    const loadedConfig = dependencies.configManager?.load({ cwd: resolvedDir }) ?? configManager.load({ cwd: resolvedDir });
    const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);

    const sandbox = effectiveConfig.sandbox ?? { mode: 'project', allowedPaths: [] };
    const sessionStore = dependencies.sessionStore ?? dependencies.createSessionStore?.();
    if (!sessionStore) {
        throw new Error('Session storage unavailable');
    }

    const session = resolveChatSession(sessionStore, {
        projectRoot: resolvedDir,
        sessionId: options.session,
        newSession: options.newSession ?? false,
    });
    const instructionAppendix = buildResolvedInstructionAppendix(
        effectiveConfig,
        resolvedDir,
        options.agent,
    );
    const agentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
        agentName: options.agent,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        modelOverride: options.model,
        promptAppendix: joinPromptAppendices(
            buildChatPromptAppendixFromRoute(
                interaction,
                sandbox,
                resolvedDir,
                resolveChatRuntimeIdentity(effectiveConfig, options.agent, options.model),
            ),
            instructionAppendix,
        ),
        session,
        runtimeProfile: runtimeDecision.runtimeProfile,
    });

    if (llmProviderRequiresApiKey(agentConfig.llmConfig.provider) && !agentConfig.llmConfig.apiKey.trim()) {
        throw new Error(MISSING_API_KEY_GUIDANCE);
    }

    const factoryConfig = {
        ...agentConfig,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        systemPrompt: agentConfig.systemPrompt ?? '',
        sandboxMode: agentConfig.sandboxMode ?? sandbox.mode,
        allowedPaths: agentConfig.allowedPaths ?? sandbox.allowedPaths,
        shell: agentConfig.shell,
    };
    const agent = dependencies.agentFactory?.(factoryConfig) ?? new XQoderAgent(agentConfig);

    let fullResponse = '';
    try {
        let finalResponse: string;
        try {
            finalResponse = await agent.run(preparedPrompt, {
                onToken: (token: string) => { fullResponse += token; },
            }, options.attachments ?? []);
        } catch (error) {
            throw await enrichProviderFailure(error, agentConfig.llmConfig, options.agent, dependencies);
        }
        fullResponse = resolveAgentTextOutput(fullResponse, finalResponse);
        const summary = sessionStore.saveSession({
            session: agent.getSession(),
            projectRoot: resolvedDir,
            cwd: resolvedDir,
            model: agentConfig.llmConfig.model,
        });
        return { response: fullResponse, sessionId: summary.id };
    } finally {
        await agent.dispose?.();
    }
}

export async function runChat(
    prompt: string,
    options: ChatRunOptions,
    dependencies: ChatServiceDependencies = {},
    callbacksFactory: () => AgentCallbacks,
): Promise<void> {
    const resolvedDir = path.resolve(options.dir);
    const interaction = resolveChatInteraction(prompt);
    const runtimeDecision = resolveRuntimeDecision(interaction);
    const preparedPrompt = runtimeDecision.shouldAugmentProjectContext
        ? maybeAugmentPromptWithProjectContextFromRoute(prompt, resolvedDir, interaction)
        : prompt;
    const loadedConfig = dependencies.configManager?.load({ cwd: resolvedDir }) ?? configManager.load({ cwd: resolvedDir });
    const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);

    const sandbox = effectiveConfig.sandbox ?? {
        mode: 'project',
        allowedPaths: [],
    };
    const sessionStore = dependencies.sessionStore ?? dependencies.createSessionStore?.();
    const session = resolveChatSession(sessionStore, {
        projectRoot: resolvedDir,
        sessionId: options.session,
        newSession: options.newSession ?? false,
    });
    const instructionAppendix = buildResolvedInstructionAppendix(
        effectiveConfig,
        resolvedDir,
        options.agent,
    );
    const agentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
        agentName: options.agent,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        modelOverride: options.model,
        promptAppendix: joinPromptAppendices(
            buildChatPromptAppendixFromRoute(
                interaction,
                sandbox,
                resolvedDir,
                resolveChatRuntimeIdentity(effectiveConfig, options.agent, options.model),
            ),
            instructionAppendix,
        ),
        session,
        runtimeProfile: runtimeDecision.runtimeProfile,
    });

    if (
        !dependencies.agentFactory
        && llmProviderRequiresApiKey(agentConfig.llmConfig.provider)
        && !agentConfig.llmConfig.apiKey.trim()
    ) {
        throw new Error(MISSING_API_KEY_GUIDANCE);
    }

    const factoryConfig = {
        ...agentConfig,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        systemPrompt: agentConfig.systemPrompt ?? '',
        sandboxMode: agentConfig.sandboxMode ?? sandbox.mode,
        allowedPaths: agentConfig.allowedPaths ?? sandbox.allowedPaths,
        shell: agentConfig.shell,
    };
    const agent = dependencies.agentFactory?.(factoryConfig) ?? new XQoderAgent(agentConfig);

    const outputFormat: OutputFormat = options.format ?? 'text';
    const isJson = outputFormat === 'json';

    const spinner = isJson ? createSpinner('Thinking...') : null;
    try {
        let fullResponse = '';
        const callbacks = isJson
            ? { ...callbacksFactory(), onToken: (token: string) => { fullResponse += token; } }
            : callbacksFactory();

        let finalResponse: string;
        try {
            finalResponse = await agent.run(preparedPrompt, callbacks, options.attachments ?? []);
        } catch (error) {
            throw await enrichProviderFailure(error, agentConfig.llmConfig, options.agent, dependencies);
        }
        fullResponse = resolveAgentTextOutput(fullResponse, finalResponse);
        sessionStore?.saveSession({
            session: agent.getSession(),
            projectRoot: resolvedDir,
            cwd: resolvedDir,
            model: agentConfig.llmConfig.model,
        });

        spinner?.stop();
        if (isJson) {
            process.stdout.write(formatOutput(fullResponse, { format: 'json' }));
        }
        process.stdout.write('\n');
    } finally {
        spinner?.stop();
        await agent.dispose?.();
    }
}

export async function runNonInteractivePrompt(
    options: NonInteractivePromptOptions,
    dependencies: ChatServiceDependencies = {},
): Promise<void> {
    const resolvedDir = path.resolve(options.cwd);
    const interaction = resolveChatInteraction(options.prompt);
    const runtimeDecision = resolveRuntimeDecision(interaction);
    const preparedPrompt = runtimeDecision.shouldAugmentProjectContext
        ? maybeAugmentPromptWithProjectContextFromRoute(options.prompt, resolvedDir, interaction)
        : options.prompt;
    const loadedConfig = dependencies.configManager?.load({ cwd: resolvedDir }) ?? configManager.load({ cwd: resolvedDir });
    const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);

    const sandbox = effectiveConfig.sandbox ?? {
        mode: 'project',
        allowedPaths: [],
    };
    const sessionStore = dependencies.sessionStore ?? dependencies.createSessionStore?.();
    const session = resolveChatSession(sessionStore, {
        projectRoot: resolvedDir,
        sessionId: options.resume,
        newSession: options.forkSession || (!options.resume && !options.continue),
    });

    const instructionAppendix = buildResolvedInstructionAppendix(
        effectiveConfig,
        resolvedDir,
        options.agent,
    );
    const agentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
        agentName: options.agent,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        modelOverride: options.model,
        promptAppendix: joinPromptAppendices(
            buildChatPromptAppendixFromRoute(
                interaction,
                sandbox,
                resolvedDir,
                resolveChatRuntimeIdentity(effectiveConfig, options.agent, options.model),
            ),
            instructionAppendix,
        ),
        session,
        sessionTitle: buildNonInteractiveTitle(options.prompt),
        autoApproveTools: options.permissionMode === undefined
            || options.permissionMode === 'allow'
            || options.permissionMode === 'auto',
        runtimeProfile: runtimeDecision.runtimeProfile,
    });

    const agent = dependencies.agentFactory?.({
        ...agentConfig,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        systemPrompt: agentConfig.systemPrompt ?? '',
        sandboxMode: agentConfig.sandboxMode ?? sandbox.mode,
        allowedPaths: agentConfig.allowedPaths ?? sandbox.allowedPaths,
        shell: agentConfig.shell,
        autoApproveTools: agentConfig.autoApproveTools,
    }) ?? new XQoderAgent(agentConfig);

    const isStreamJson = options.outputFormat === 'stream-json';
    const spinner = !options.quiet && options.outputFormat === 'text'
        ? createSpinner('Thinking...')
        : null;

    if (isStreamJson) {
        process.stdout.write(JSON.stringify({ type: 'session_start', sessionId: agent.getSession().id }) + '\n');
    }

    try {
        let fullResponse = '';
        let finalResponse: string;
        try {
            finalResponse = await agent.run(preparedPrompt, {
                onToken: (token: string) => {
                    fullResponse += token;
                    if (isStreamJson) {
                        process.stdout.write(JSON.stringify({ type: 'assistant_delta', text: token }) + '\n');
                    }
                },
                onEvent: (event) => {
                    if (isStreamJson) {
                        process.stdout.write(JSON.stringify({ type: 'agent_event', event }) + '\n');
                    }
                }
            });
        } catch (error) {
            throw await enrichProviderFailure(error, agentConfig.llmConfig, options.agent, dependencies);
        }
        fullResponse = resolveAgentTextOutput(fullResponse, finalResponse);

        if (!options.noSessionPersistence) {
            sessionStore?.saveSession({
                session: agent.getSession(),
                projectRoot: resolvedDir,
                cwd: resolvedDir,
                model: agentConfig.llmConfig.model,
            });
        }

        spinner?.stop();
        if (isStreamJson) {
            process.stdout.write(JSON.stringify({ type: 'final_result', response: fullResponse }) + '\n');
        } else {
            process.stdout.write(formatOutput(fullResponse, { format: options.outputFormat }));
            process.stdout.write('\n');
        }
    } finally {
        spinner?.stop();
        await agent.dispose?.();
    }
}


async function enrichProviderFailure(
    error: unknown,
    llmConfig: LocalFallbackInput['llmConfig'],
    agentName: string | undefined,
    dependencies: ChatServiceDependencies,
): Promise<Error> {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const advisor = dependencies.localFallbackAdvisor ?? buildLocalFallbackGuidance;
    const guidance = await advisor({ error: normalized, llmConfig, agentName });
    if (!guidance) {
        return normalized;
    }
    return new Error(`${normalized.message}

${guidance}`);
}

function buildNonInteractiveTitle(prompt: string): string {
    const trimmedPrompt = prompt.trim();
    const titleSuffix = trimmedPrompt.length > 100
        ? `${trimmedPrompt.slice(0, 100)}...`
        : trimmedPrompt;

    return `Non-interactive: ${titleSuffix}`;
}

function resolveAgentTextOutput(streamedResponse: string, finalResponse: string): string {
    return streamedResponse.length > 0 ? streamedResponse : finalResponse;
}

function joinPromptAppendices(...appendices: Array<string | undefined>): string {
    return appendices.filter((entry): entry is string => Boolean(entry?.trim())).join('\n\n');
}

function buildResolvedInstructionAppendix(
    effectiveConfig: ReturnType<typeof resolveConfigWithEnvOverrides>['config'],
    cwd: string,
    agentName: string | undefined,
): string | undefined {
    const resolvedAgentName = agentName?.trim() || resolveDefaultAgentName(effectiveConfig);
    return buildInstructionAppendix(resolveInstructionSet({
        cwd,
        projectConfigInstructions: effectiveConfig.agents?.[resolvedAgentName]?.instructions,
        userConfigInstructions: effectiveConfig.instructions,
    }));
}
