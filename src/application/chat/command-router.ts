import {
    buildWorkflowPrompt,
    defaultAgentForWorkflowMode,
} from '../workflows/index.js';
import { resolveChatInteraction } from './interaction-router.js';
import type { ChatInteractionRoute } from './interaction-types.js';

type WorkflowCommandMode = 'plan' | 'review';

const CHAT_COMMAND_ALIASES = {
    status: ['/status', '/stats'],
    permissions: ['/permissions', '/auth'],
    tools: ['/tools'],
    compact: ['/compact', '/compress'],
    implement: ['/implement'],
    plan: ['/plan'],
    review: ['/review'],
} as const;

export type ChatCommandRoute =
    | { kind: 'none' }
    | { kind: 'status' }
    | { kind: 'permissions' }
    | { kind: 'tools' }
    | { kind: 'compact' }
    | { kind: 'implement'; input: string }
    | {
        kind: 'workflow';
        mode: WorkflowCommandMode;
        input: string;
        defaultAgentName: string;
    }
    | {
        kind: 'usage';
        command: WorkflowCommandMode | 'implement';
        response: string;
    };

export interface ResolvedChatTurnRoute {
    commandRoute: ChatCommandRoute;
    interaction: ChatInteractionRoute;
    routedPrompt: string;
}

export function resolveChatCommandRoute(prompt: string): ChatCommandRoute {
    const trimmed = prompt.trim();
    if (!trimmed) {
        return { kind: 'none' };
    }

    const statusAlias = matchCommandAlias(trimmed, CHAT_COMMAND_ALIASES.status);
    if (statusAlias) {
        return { kind: 'status' };
    }

    const permissionsAlias = matchCommandAlias(trimmed, CHAT_COMMAND_ALIASES.permissions);
    if (permissionsAlias) {
        return { kind: 'permissions' };
    }

    const toolsAlias = matchCommandAlias(trimmed, CHAT_COMMAND_ALIASES.tools);
    if (toolsAlias) {
        return { kind: 'tools' };
    }

    const compactAlias = matchCommandAlias(trimmed, CHAT_COMMAND_ALIASES.compact);
    if (compactAlias) {
        return { kind: 'compact' };
    }

    const implementAlias = matchCommandAlias(trimmed, CHAT_COMMAND_ALIASES.implement);
    if (implementAlias) {
        const input = trimmed.slice(implementAlias.length).trim();
        return input
            ? {
                kind: 'implement',
                input,
            }
            : {
                kind: 'usage',
                command: 'implement',
                response: 'Usage: /implement <goal>',
            };
    }

    const planAlias = matchCommandAlias(trimmed, CHAT_COMMAND_ALIASES.plan);
    if (planAlias) {
        const input = trimmed.slice(planAlias.length).trim();
        return input
            ? {
                kind: 'workflow',
                mode: 'plan',
                input,
                defaultAgentName: defaultAgentForWorkflowMode('plan'),
            }
            : {
                kind: 'usage',
                command: 'plan',
                response: 'Usage: /plan <goal>',
            };
    }

    const reviewAlias = matchCommandAlias(trimmed, CHAT_COMMAND_ALIASES.review);
    if (reviewAlias) {
        const input = trimmed.slice(reviewAlias.length).trim();
        return input
            ? {
                kind: 'workflow',
                mode: 'review',
                input,
                defaultAgentName: defaultAgentForWorkflowMode('review'),
            }
            : {
                kind: 'usage',
                command: 'review',
                response: 'Usage: /review <scope>',
            };
    }

    return { kind: 'none' };
}

export function resolveChatTurnRoute(prompt: string): ResolvedChatTurnRoute {
    const commandRoute = resolveChatCommandRoute(prompt);
    if (commandRoute.kind === 'workflow') {
        return {
            commandRoute,
            interaction: {
                kind: 'engineering_task',
                normalizedPrompt: commandRoute.input,
                usesStructuredResponse: true,
                includesRuntimeIdentity: false,
                augmentsProjectContext: false,
                addsCapabilityGuidance: false,
            },
            routedPrompt: buildWorkflowPrompt(commandRoute.mode, commandRoute.input),
        };
    }

    if (commandRoute.kind === 'implement') {
        return {
            commandRoute,
            interaction: {
                kind: 'engineering_task',
                normalizedPrompt: commandRoute.input,
                usesStructuredResponse: true,
                includesRuntimeIdentity: false,
                augmentsProjectContext: false,
                addsCapabilityGuidance: false,
            },
            routedPrompt: commandRoute.input,
        };
    }

    return {
        commandRoute,
        interaction: resolveChatInteraction(prompt),
        routedPrompt: prompt,
    };
}

export function isDirectChatCommandRoute(route: ChatCommandRoute): boolean {
    return route.kind === 'status'
        || route.kind === 'permissions'
        || route.kind === 'tools'
        || route.kind === 'compact'
        || route.kind === 'usage';
}

function matchCommandAlias(
    prompt: string,
    aliases: readonly string[],
): string | undefined {
    return aliases.find((alias) => prompt === alias || prompt.startsWith(`${alias} `));
}
