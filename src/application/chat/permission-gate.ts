import type {
    ApprovalPolicy,
    ExecutionCapability,
    PermissionSettings,
    TaskMode,
} from '@xqoder/shared';
import {
    createScopedPermissionSettings,
    resolveV1ApprovalPolicy,
} from '../../domain/permissions/index.js';
import type { ChatCommandRoute } from './command-router.js';
import type { ChatInteractionRoute } from './interaction-types.js';

const DEBUG_FIX_TRIGGER = /(?:\b(?:bug|error|exception|typeerror|referenceerror|syntaxerror|stack trace|regression|debug|crash|broken|failing)\b|修复|报错|异常|回归|排查|调试|崩溃)/i;

export interface TurnPermissionGate {
    taskMode: TaskMode;
    executionCapability: ExecutionCapability;
    approvalPolicy: ApprovalPolicy;
    permissions: PermissionSettings;
}

export function buildTurnPermissionGate(input: {
    commandRoute: ChatCommandRoute;
    interaction: ChatInteractionRoute;
    permissions: PermissionSettings | undefined;
}): TurnPermissionGate {
    const taskMode = resolveTaskModeFromTurn(input.commandRoute, input.interaction);
    const executionCapability = resolveExecutionCapability(taskMode);
    const approvalPolicy = resolveV1ApprovalPolicy(input.permissions);

    return {
        taskMode,
        executionCapability,
        approvalPolicy,
        permissions: createScopedPermissionSettings({
            executionCapability,
            approvalPolicy,
            basePermissions: input.permissions,
        }),
    };
}

export function resolveTaskModeFromTurn(
    commandRoute: ChatCommandRoute,
    interaction: ChatInteractionRoute,
): TaskMode {
    if (commandRoute.kind === 'workflow') {
        return commandRoute.mode === 'plan' ? 'plan_only' : 'code_review';
    }

    switch (interaction.kind) {
        case 'casual':
        case 'identity':
        case 'capability':
            return 'casual_chat';
        case 'project_explanation':
        case 'file_analysis':
        case 'config_or_runtime':
            return 'project_question';
        case 'engineering_task':
            return DEBUG_FIX_TRIGGER.test(interaction.normalizedPrompt)
                ? 'debug_fix'
                : 'engineering_edit';
        default:
            return 'engineering_edit';
    }
}

export function resolveExecutionCapability(
    taskMode: TaskMode,
): ExecutionCapability {
    switch (taskMode) {
        case 'plan_only':
            return 'plan';
        case 'code_review':
            return 'read_only';
        case 'casual_chat':
        case 'project_question':
        case 'engineering_edit':
        case 'debug_fix':
        default:
            return 'workspace_write';
    }
}
