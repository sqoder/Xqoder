import * as path from 'node:path';
import {
    configManager,
    resolveConfigWithEnvOverrides,
    type PermissionSettings,
    type SandboxSettings,
} from '@xqoder/shared';
import {
    AgentSession,
    SummarizerAgent,
    TitleAgent,
    buildAgentConfigFromXQoderConfig,
    type AgentConfig,
} from '@xqoder/agent';
import type { AgentSessionStore } from '@xqoder/storage-sqlite';
import type {
    SendMessageResult,
    TuiAgentSettings,
} from '../../application/agent/index.js';
import { buildConversationTurnInput } from '../../application/chat/turn-intake.js';
import {
    buildChatPromptAppendixFromRoute,
    resolveChatRuntimeIdentity,
} from '../../application/chat/prompt-composer.js';
import {
    resolveAgentInstructionAppendix,
} from '../../application/instructions/index.js';

export interface ResolvedTuiAgentConfig {
    resolvedDir: string;
    permissions: PermissionSettings | undefined;
    baseAgentConfig: AgentConfig;
}

export interface ResolvedTuiAgentSendContext extends ResolvedTuiAgentConfig {
    session: AgentSession | undefined;
    activeSession: AgentSession;
    agentConfig: AgentConfig;
}

interface TuiAgentSessionDependencies {
    resolveAgentConfig?: (params: {
        settings: TuiAgentSettings;
        session?: AgentSession;
        message?: string;
        includePermissionPromptAppendix?: boolean;
    }) => ResolvedTuiAgentConfig;
    createSummarizer?: (llmConfig: AgentConfig['llmConfig']) => {
        summarize(messages: ReturnType<AgentSession['getMessages']>): Promise<string | null | undefined>;
    };
    createTitleAgent?: (llmConfig: AgentConfig['llmConfig']) => {
        generateTitle(message: string): Promise<string | null | undefined>;
    };
}

export function resolveTuiAgentConfig(
    params: {
        settings: TuiAgentSettings;
        session?: AgentSession;
        message?: string;
        includePermissionPromptAppendix?: boolean;
    },
): ResolvedTuiAgentConfig {
    const { settings, session, message = '', includePermissionPromptAppendix = false } = params;
    const resolvedDir = path.resolve(settings.dir);
    const loadedConfig = configManager.load({ cwd: resolvedDir });
    const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);
    const sandbox = effectiveConfig.sandbox ?? {
        mode: 'project',
        allowedPaths: [],
    } satisfies SandboxSettings;
    const turnInput = buildConversationTurnInput({
        prompt: message,
        cwd: resolvedDir,
        sessionId: session?.id,
        startNewSession: !session,
        model: settings.model,
        agent: settings.agent,
        entrypoint: 'tui',
    });
    const runtimeDecision = turnInput.runtime.runtimeDecision;
    const runtimeIdentity = runtimeDecision.shouldIncludeRuntimeIdentity
        ? resolveChatRuntimeIdentity(effectiveConfig, settings.agent, settings.model)
        : undefined;
    const chatPromptAppendix = buildChatPromptAppendixFromRoute(
        turnInput.runtime.interaction,
        sandbox,
        resolvedDir,
        runtimeIdentity,
    );
    const instructionPromptAppendix = resolveAgentInstructionAppendix({
        config: effectiveConfig,
        cwd: resolvedDir,
        agentName: settings.agent,
    });
    const permissionPromptAppendix = includePermissionPromptAppendix
        ? [
            'Permission execution rules:',
            '- When the user explicitly requests a path outside the project (e.g., Desktop), you MUST attempt use the target path directly.',
            '- Do NOT reply "cannot access system path" and offer an alternative script instead.',
            '- Let the tool trigger the permission approval dialog, allowing the user to decide (allow once / allow full session / deny).',
        ].join('\n')
        : undefined;
    const promptAppendix = [
        chatPromptAppendix,
        instructionPromptAppendix,
        permissionPromptAppendix,
    ].filter((value): value is string => Boolean(value?.trim())).join('\n\n');

    return {
        resolvedDir,
        permissions: effectiveConfig.permissions,
        baseAgentConfig: buildAgentConfigFromXQoderConfig(effectiveConfig, {
            agentName: settings.agent,
            cwd: resolvedDir,
            projectRoot: resolvedDir,
            modelOverride: settings.model,
            promptAppendix,
            session,
            runtimeProfile: runtimeDecision.runtimeProfile,
        }),
    };
}

export function resolveTuiAgentSendContext(
    sessionStore: AgentSessionStore,
    sessionId: string | undefined,
    settings: TuiAgentSettings,
    messageOrDependencies: string | TuiAgentSessionDependencies = '',
    maybeDependencies: TuiAgentSessionDependencies = {},
): ResolvedTuiAgentSendContext {
    const message = typeof messageOrDependencies === 'string' ? messageOrDependencies : '';
    const dependencies = typeof messageOrDependencies === 'string'
        ? maybeDependencies
        : messageOrDependencies;
    const session = sessionId ? sessionStore.getSession(sessionId) ?? undefined : undefined;
    const resolveAgentConfig = dependencies.resolveAgentConfig ?? resolveTuiAgentConfig;
    const {
        resolvedDir,
        permissions,
        baseAgentConfig,
    } = resolveAgentConfig({
        settings,
        session,
        message,
    });

    if (session) {
        session.setSystemPrompt(baseAgentConfig.systemPrompt);
    }
    const activeSession = session ?? new AgentSession({
        systemPrompt: baseAgentConfig.systemPrompt,
    });

    return {
        resolvedDir,
        permissions,
        baseAgentConfig,
        session,
        activeSession,
        agentConfig: {
            ...baseAgentConfig,
            cwd: resolvedDir,
            projectRoot: resolvedDir,
            session: activeSession,
        },
    };
}

export async function compactTuiAgentSession(
    sessionStore: AgentSessionStore,
    sessionId: string,
    settings: TuiAgentSettings,
    dependencies: TuiAgentSessionDependencies = {},
): Promise<string | null> {
    const session = sessionStore.getSession(sessionId);
    if (!session) {
        return null;
    }

    const resolveAgentConfig = dependencies.resolveAgentConfig ?? resolveTuiAgentConfig;
    const {
        resolvedDir,
        baseAgentConfig,
    } = resolveAgentConfig({
        settings,
        session,
        message: '',
        includePermissionPromptAppendix: true,
    });

    const messages = session.getMessages().filter((message) => message.role !== 'system');
    if (messages.length < 4) {
        return null;
    }

    const summarizer = dependencies.createSummarizer?.(baseAgentConfig.llmConfig) ?? new SummarizerAgent(baseAgentConfig.llmConfig);
    const summary = await summarizer.summarize(messages);
    if (!summary?.trim()) {
        return null;
    }

    session.performCompaction(summary);
    sessionStore.saveSession({
        session,
        projectRoot: resolvedDir,
        cwd: resolvedDir,
        model: baseAgentConfig.llmConfig.model,
    });

    return summary;
}

export function persistTuiAgentSession(
    params: {
        sessionStore: AgentSessionStore;
        activeSession: AgentSession;
        resolvedDir: string;
        agentConfig: AgentConfig;
        userMessage: string;
        onTitleGenerated?: (sessionId: string, title: string) => void;
    },
    dependencies: TuiAgentSessionDependencies = {},
): SendMessageResult {
    const {
        sessionStore,
        activeSession,
        resolvedDir,
        agentConfig,
        userMessage,
        onTitleGenerated,
    } = params;

    const savedSummary = sessionStore.saveSession({
        session: activeSession,
        projectRoot: resolvedDir,
        cwd: resolvedDir,
        model: agentConfig.llmConfig.model,
    });

    if (savedSummary.title === savedSummary.lastUserMessage?.slice(0, 50) || !savedSummary.title) {
        const sid = savedSummary.id;
        const titleFactory = dependencies.createTitleAgent ?? ((llmConfig) => new TitleAgent(llmConfig));
        void (async () => {
            try {
                const titleAgent = titleFactory(agentConfig.llmConfig);
                const generatedTitle = await titleAgent.generateTitle(userMessage);
                if (generatedTitle) {
                    try {
                        sessionStore.updateSessionTitle(sid, generatedTitle);
                    } catch {
                        // title persistence is best-effort
                    }
                    onTitleGenerated?.(sid, generatedTitle);
                }
            } catch {
                // title generation is best-effort
            }
        })();
    }

    return {
        sessionId: savedSummary.id,
        sessionTitle: savedSummary.title,
    };
}
