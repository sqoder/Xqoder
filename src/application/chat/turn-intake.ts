import * as path from 'node:path';
import {
    ConfigManager,
    configManager,
    resolveConfigWithEnvOverrides,
    type MessageAttachment,
    type OutputFormat,
} from '@xqoder/shared';
import { resolveRuntimeDecision } from '@xqoder/core-runtime';
import {
    AgentSession,
    buildAgentConfigFromXQoderConfig,
} from '@xqoder/agent';
import type { ChatSessionStore, ChatAgentFactoryConfig } from './ports.js';
import {
    buildChatPromptAppendixFromRoute,
    maybeAugmentPromptWithProjectContextFromRoute,
    resolveChatRuntimeIdentity,
} from './prompt-composer.js';
import {
    isDirectChatCommandRoute,
    resolveChatTurnRoute,
    type ChatCommandRoute,
} from './command-router.js';
import type { ChatInteractionRoute } from './interaction-types.js';
import {
    resolveAgentInstructionAppendix,
} from '../instructions/index.js';
import {
    buildWorkflowPrompt,
    defaultAgentForWorkflowMode,
} from '../workflows/index.js';
import { buildTurnPermissionGate } from './permission-gate.js';
import { resolveTurnAttachments } from './turn-intake/attachment-resolver.js';
import { loadMemdirContextSync } from '../memory/memdir.js';
import { renderMemoryAppendix } from './turn-intake/memory-loader.js';
import {
    appendOutputStyleTail,
    resolveActiveOutputStyleTail,
} from '@xqoder/core-output-styles';

const DEFAULT_SANDBOX = {
    mode: 'project',
    allowedPaths: [] as string[],
} as const;

export type ChatRuntimeDecision = ReturnType<typeof resolveRuntimeDecision>;
export type ConversationTurnEntrypoint = 'cli' | 'tui' | 'http' | 'headless';

export type ChatSessionIntent =
    | { mode: 'new' }
    | { mode: 'resume-latest' }
    | { mode: 'resume-explicit'; sessionId: string };

export interface ConversationSlashCommand {
    raw: string;
    route: Exclude<ChatCommandRoute, { kind: 'none' }>;
}

export interface ConversationTurnInput {
    rawText: string;
    normalizedText: string;
    preparedText: string;
    attachments: MessageAttachment[];
    referencedFiles: string[];
    slashCommand?: ConversationSlashCommand;
    cwd: string;
    sessionId?: string;
    entrypoint: ConversationTurnEntrypoint;
    outputFormat: OutputFormat;
    sessionIntent: ChatSessionIntent;
    shouldPersistSession: boolean;
    requireSessionStore: boolean;
    model?: string;
    agent?: string;
    sessionTitle?: string;
    autoApproveTools?: boolean;
    maxTurns?: number;
    runtime: {
        commandRoute: ChatCommandRoute;
        interaction: ChatInteractionRoute;
        runtimeDecision: ChatRuntimeDecision;
    };
    // Legacy ChatTurnInput aliases preserved for compatibility.
    rawPrompt: string;
    preparedPrompt: string;
    resolvedDir: string;
}

export type ChatTurnInput = ConversationTurnInput;

export interface BuildConversationTurnInputOptions {
    prompt: string;
    cwd: string;
    attachments?: MessageAttachment[];
    outputFormat?: OutputFormat;
    sessionId?: string;
    startNewSession?: boolean;
    shouldPersistSession?: boolean;
    requireSessionStore?: boolean;
    model?: string;
    agent?: string;
    sessionTitle?: string;
    autoApproveTools?: boolean;
    maxTurns?: number;
    entrypoint?: ConversationTurnEntrypoint;
}

export type BuildChatTurnInputOptions = BuildConversationTurnInputOptions;

export interface ChatTurnIntakeDependencies {
    configManager?: Pick<ConfigManager, 'load'>;
    sessionStore?: ChatSessionStore;
    createSessionStore?: () => ChatSessionStore | undefined;
}

export interface PreparedChatExecution<TTurnInput extends ConversationTurnInput = ConversationTurnInput> {
    turnInput: TTurnInput;
    sessionStore?: ChatSessionStore;
    sandbox: {
        mode: ChatAgentFactoryConfig['sandboxMode'];
        allowedPaths: string[];
    };
    agentConfig: ReturnType<typeof buildAgentConfigFromXQoderConfig>;
}

/**
 * Normalizes raw entrypoint input into a reusable application-layer turn input.
 * Provider/tool loop ownership and transport concerns stay outside this module.
 */
export function buildConversationTurnInput(
    options: BuildConversationTurnInputOptions,
): ConversationTurnInput {
    const resolvedDir = path.resolve(options.cwd);
    const turnRoute = resolveChatTurnRoute(options.prompt);
    const runtimeDecision = resolveRuntimeDecision(turnRoute.interaction);
    const preparedText = runtimeDecision.shouldAugmentProjectContext
        ? maybeAugmentPromptWithProjectContextFromRoute(turnRoute.routedPrompt, resolvedDir, turnRoute.interaction)
        : turnRoute.routedPrompt;
    const directCommand = isDirectChatCommandRoute(turnRoute.commandRoute);
    const normalizedText = resolveNormalizedTurnText(options.prompt, turnRoute);
    const slashCommand = resolveSlashCommand(options.prompt, turnRoute.commandRoute);
    const mentionResolution = directCommand
        ? { attachments: options.attachments?.map((attachment) => ({ ...attachment })) ?? [] }
        : resolveTurnAttachments({
            prompt: options.prompt,
            cwd: resolvedDir,
            ...(options.attachments ? { userProvided: options.attachments } : {}),
        });

    return {
        rawText: options.prompt,
        normalizedText,
        preparedText,
        attachments: mentionResolution.attachments,
        referencedFiles: extractReferencedFiles(options.prompt, mentionResolution.attachments),
        ...(slashCommand ? { slashCommand } : {}),
        cwd: resolvedDir,
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        entrypoint: options.entrypoint ?? 'cli',
        outputFormat: options.outputFormat ?? 'text',
        sessionIntent: resolveSessionIntent({
            sessionId: options.sessionId,
            startNewSession: options.startNewSession ?? false,
        }),
        shouldPersistSession: directCommand ? false : options.shouldPersistSession ?? true,
        requireSessionStore: directCommand ? false : options.requireSessionStore ?? false,
        ...(options.model ? { model: options.model } : {}),
        ...(options.agent
            ? { agent: options.agent }
            : turnRoute.commandRoute.kind === 'workflow'
                ? { agent: turnRoute.commandRoute.defaultAgentName }
                : {}),
        ...(options.sessionTitle ? { sessionTitle: options.sessionTitle } : {}),
        ...(options.autoApproveTools !== undefined ? { autoApproveTools: options.autoApproveTools } : {}),
        ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
        runtime: {
            commandRoute: turnRoute.commandRoute,
            interaction: turnRoute.interaction,
            runtimeDecision,
        },
        rawPrompt: options.prompt,
        preparedPrompt: preparedText,
        resolvedDir,
    };
}

export function buildChatTurnInput(options: BuildChatTurnInputOptions): ChatTurnInput {
    return buildConversationTurnInput(options);
}

export function prepareChatExecution<TTurnInput extends ConversationTurnInput>(
    turnInput: TTurnInput,
    dependencies: ChatTurnIntakeDependencies = {},
): PreparedChatExecution<TTurnInput> {
    const loadedConfig = dependencies.configManager?.load({ cwd: turnInput.cwd }) ?? configManager.load({ cwd: turnInput.cwd });
    const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);
    const sandbox = effectiveConfig.sandbox ?? DEFAULT_SANDBOX;
    const sessionStore = dependencies.sessionStore ?? dependencies.createSessionStore?.();

    if (turnInput.requireSessionStore && !sessionStore) {
        throw new Error('Session storage unavailable');
    }

    const session = resolveChatSession(sessionStore, {
        projectRoot: turnInput.cwd,
        sessionIntent: turnInput.sessionIntent,
    });
    const effectiveTurnInput = resolveEffectiveTurnInput(turnInput, session);
    const instructionAppendix = buildResolvedInstructionAppendix(
        effectiveConfig,
        effectiveTurnInput.cwd,
        effectiveTurnInput.agent,
    );
    const memoryAppendix = buildTurnMemoryAppendix(effectiveTurnInput);
    const permissionGate = buildTurnPermissionGate({
        commandRoute: effectiveTurnInput.runtime.commandRoute,
        interaction: effectiveTurnInput.runtime.interaction,
        permissions: effectiveConfig.permissions,
    });
    const agentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
        agentName: effectiveTurnInput.agent,
        cwd: effectiveTurnInput.cwd,
        projectRoot: effectiveTurnInput.cwd,
        modelOverride: effectiveTurnInput.model,
        promptAppendix: applyOutputStyleTail(
            joinPromptAppendices(
                buildChatPromptAppendixFromRoute(
                    effectiveTurnInput.runtime.interaction,
                    sandbox,
                    effectiveTurnInput.cwd,
                    resolveChatRuntimeIdentity(effectiveConfig, effectiveTurnInput.agent, effectiveTurnInput.model),
                ),
                instructionAppendix,
                memoryAppendix,
            ),
            effectiveTurnInput.cwd,
        ),
        session,
        sessionTitle: effectiveTurnInput.sessionTitle,
        autoApproveTools: effectiveTurnInput.autoApproveTools,
        runtimeProfile: effectiveTurnInput.runtime.runtimeDecision.runtimeProfile,
        permissionsOverride: permissionGate.permissions,
        taskMode: permissionGate.taskMode,
        executionCapability: permissionGate.executionCapability,
        approvalPolicy: permissionGate.approvalPolicy,
        ...(effectiveTurnInput.maxTurns !== undefined ? { maxIterations: effectiveTurnInput.maxTurns } : {}),
    });

    return {
        turnInput: effectiveTurnInput,
        sessionStore,
        sandbox: {
            mode: sandbox.mode,
            allowedPaths: [...sandbox.allowedPaths],
        },
        agentConfig,
    };
}

function resolveSessionIntent(options: {
    sessionId?: string;
    startNewSession: boolean;
}): ChatSessionIntent {
    if (options.startNewSession) {
        return { mode: 'new' };
    }
    if (options.sessionId) {
        return { mode: 'resume-explicit', sessionId: options.sessionId };
    }
    return { mode: 'resume-latest' };
}

function resolveChatSession(
    sessionStore: Pick<ChatSessionStore, 'findLatestSession' | 'getSession'> | undefined,
    options: {
        projectRoot: string;
        sessionIntent: ChatSessionIntent;
    },
): AgentSession | undefined {
    if (!sessionStore || options.sessionIntent.mode === 'new') {
        return undefined;
    }
    if (options.sessionIntent.mode === 'resume-explicit') {
        const explicitSession = sessionStore.getSession(options.sessionIntent.sessionId);
        if (!explicitSession) {
            throw new Error(`Specified session not found: ${options.sessionIntent.sessionId}`);
        }
        return explicitSession;
    }
    return sessionStore.findLatestSession(options.projectRoot) ?? undefined;
}

export function normalizeWorkflowGoal(input: string): string {
    return input.replace(/\s+/g, ' ').trim();
}

function joinPromptAppendices(...appendices: Array<string | undefined>): string {
    return appendices.filter((entry): entry is string => Boolean(entry?.trim())).join('\n\n');
}

// Kept as a dynamic tail so the style append does not break the static
// prompt-cache prefix built by `buildChatPromptAppendixFromRoute`. Selection
// is persisted per-project via `.xqoder/state/output-style.json`.
function applyOutputStyleTail(prompt: string, projectRoot: string): string {
    const style = resolveActiveOutputStyleTail(projectRoot);
    return appendOutputStyleTail(prompt, style);
}

function buildResolvedInstructionAppendix(
    effectiveConfig: ReturnType<typeof resolveConfigWithEnvOverrides>['config'],
    cwd: string,
    agentName: string | undefined,
): string | undefined {
    return resolveAgentInstructionAppendix({
        config: effectiveConfig,
        cwd,
        agentName,
    });
}

function buildTurnMemoryAppendix(turnInput: ConversationTurnInput): string | undefined {
    if (isDirectChatCommandRoute(turnInput.runtime.commandRoute)) {
        return undefined;
    }
    const prompt = turnInput.normalizedText || turnInput.rawText;
    if (!prompt.trim()) return undefined;
    const { memories } = loadMemdirContextSync({
        cwd: turnInput.cwd,
        sessionId: turnInput.sessionId ?? 'pending',
        prompt,
    });
    return renderMemoryAppendix(memories);
}

function resolveNormalizedTurnText(
    prompt: string,
    turnRoute: ReturnType<typeof resolveChatTurnRoute>,
): string {
    if (turnRoute.commandRoute.kind === 'workflow' || turnRoute.commandRoute.kind === 'implement') {
        return turnRoute.commandRoute.input;
    }
    return turnRoute.interaction.normalizedPrompt || prompt.replace(/\s+/g, ' ').trim();
}

function resolveSlashCommand(
    prompt: string,
    route: ChatCommandRoute,
): ConversationSlashCommand | undefined {
    if (route.kind === 'none') {
        return undefined;
    }

    const raw = prompt.trim().split(/\s+/, 1)[0]?.trim();
    if (!raw) {
        return undefined;
    }

    return {
        raw,
        route,
    };
}

function resolveEffectiveTurnInput<TTurnInput extends ConversationTurnInput>(
    turnInput: TTurnInput,
    session: AgentSession | undefined,
): TTurnInput {
    let effectiveTurnInput = turnInput;
    const existingWorkflow = session && typeof session.getWorkflowState === 'function'
        ? session.getWorkflowState()
        : undefined;

    if (turnInput.runtime.commandRoute.kind === 'implement') {
        const normalizedGoal = normalizeWorkflowGoal(turnInput.runtime.commandRoute.input);
        const approvedPlan = existingWorkflow?.kind === 'plan'
            && existingWorkflow.normalizedGoal === normalizedGoal;

        if (!approvedPlan) {
            effectiveTurnInput = rerouteTurnInputToWorkflow(turnInput, 'plan', turnInput.runtime.commandRoute.input);
        }
    }

    if (
        session
        && shouldInvalidateWorkflowState(effectiveTurnInput.runtime.commandRoute)
        && typeof session.clearWorkflowState === 'function'
    ) {
        session.clearWorkflowState();
    }

    return effectiveTurnInput;
}

function rerouteTurnInputToWorkflow<TTurnInput extends ConversationTurnInput>(
    turnInput: TTurnInput,
    mode: 'plan' | 'review',
    input: string,
): TTurnInput {
    const routedPrompt = buildWorkflowPrompt(mode, input);
    const interaction: ChatInteractionRoute = {
        kind: 'engineering_task',
        normalizedPrompt: input,
        usesStructuredResponse: true,
        includesRuntimeIdentity: false,
        augmentsProjectContext: false,
        addsCapabilityGuidance: false,
    };
    const runtimeDecision = resolveRuntimeDecision(interaction);
    const preparedText = runtimeDecision.shouldAugmentProjectContext
        ? maybeAugmentPromptWithProjectContextFromRoute(routedPrompt, turnInput.cwd, interaction)
        : routedPrompt;
    const commandRoute: ChatCommandRoute = {
        kind: 'workflow',
        mode,
        input,
        defaultAgentName: defaultAgentForWorkflowMode(mode),
    };

    return {
        ...turnInput,
        normalizedText: input,
        preparedText,
        ...(turnInput.agent ? {} : { agent: commandRoute.defaultAgentName }),
        runtime: {
            commandRoute,
            interaction,
            runtimeDecision,
        },
        ...(turnInput.slashCommand
            ? {
                slashCommand: {
                    ...turnInput.slashCommand,
                    route: commandRoute,
                },
            }
            : {}),
        preparedPrompt: preparedText,
    };
}

function shouldInvalidateWorkflowState(route: ChatCommandRoute): boolean {
    if (isDirectChatCommandRoute(route)) {
        return false;
    }

    return route.kind === 'none'
        || route.kind === 'implement'
        || route.kind === 'skill'
        || route.kind === 'workflow';
}

function extractReferencedFiles(
    prompt: string,
    attachments: MessageAttachment[] | undefined,
): string[] {
    const matches = new Set<string>();
    const fileReferencePattern = /(?:^|[\s("'`])((?:\.{1,2}\/|\/)?(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]{1,12})(?=$|[\s)"'`,:])/g;

    for (const attachment of attachments ?? []) {
        const filePath = attachment.filePath?.trim();
        if (filePath) {
            matches.add(filePath);
        }
    }

    for (const match of prompt.matchAll(fileReferencePattern)) {
        const candidate = match[1]?.trim();
        if (!candidate || candidate.includes('://')) {
            continue;
        }
        matches.add(candidate);
    }

    return [...matches];
}
