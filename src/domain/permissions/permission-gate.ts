import type {
    AgentPermissionMode,
    ApprovalPolicy,
    ExecutionCapability,
    PermissionSettings,
} from '@xqoder/foundation-shared/types/permissions.js';
import type { ToolSecurityPolicyContext } from './tool-policy.js';
import { isMcpReadOnlyOperation } from './tool-policy.js';

export const SUPPORTED_V1_APPROVAL_POLICIES = [
    'strict',
    'balanced',
    'workspace_auto',
] as const;

const NON_WRITE_VISIBLE_TOOL_NAMES = new Set([
    'read_file',
    'search_code',
    'grep_content',
    'glob_files',
    'list_files',
    'sourcegraph',
    'diagnostics',
    'fetch_url',
    'websearch',
    'skill',
    'todoread',
    'question',
    'discover_skills',
    'delegate_task',
]);

interface PolicyBaseline {
    defaultMode: AgentPermissionMode;
    tools: Record<string, AgentPermissionMode>;
}

export function resolveV1ApprovalPolicy(
    permissions: PermissionSettings | undefined,
): ApprovalPolicy {
    const configured = permissions?.approvalPolicy;
    if (configured === 'strict' || configured === 'balanced' || configured === 'workspace_auto') {
        return configured;
    }

    if (permissions?.defaultMode === 'allow') {
        return 'workspace_auto';
    }

    if (permissions?.defaultMode === 'deny' || permissions?.defaultMode === 'ask') {
        return 'strict';
    }

    return 'balanced';
}

export function createScopedPermissionSettings(input: {
    executionCapability: ExecutionCapability;
    approvalPolicy: ApprovalPolicy;
    basePermissions?: PermissionSettings;
}): PermissionSettings {
    const approvalPolicy = normalizeApprovalPolicy(input.approvalPolicy);
    const baseline = createPolicyBaseline(approvalPolicy);
    const toolModes = {
        ...baseline.tools,
        ...(input.basePermissions?.tools ?? {}),
    };

    if (input.executionCapability !== 'workspace_write') {
        toolModes.edit = 'deny';
        toolModes.bash = 'deny';
        toolModes.todowrite = 'deny';
    }

    return {
        defaultMode: baseline.defaultMode,
        tools: toolModes,
        ...(input.basePermissions?.allowedTools
            ? { allowedTools: [...input.basePermissions.allowedTools] }
            : {}),
        ...(input.basePermissions?.disallowedTools
            ? { disallowedTools: [...input.basePermissions.disallowedTools] }
            : {}),
        approvalPolicy,
    };
}

export function isToolVisibleForExecutionCapability(
    toolName: string,
    executionCapability: ExecutionCapability,
    securityContext?: ToolSecurityPolicyContext,
): boolean {
    if (executionCapability === 'workspace_write') {
        return true;
    }

    if (securityContext?.source === 'mcp' || toolName.startsWith('mcp.')) {
        return isMcpReadOnlyOperation(securityContext, toolName);
    }

    if (toolName.startsWith('lsp_')) {
        return toolName !== 'lsp_rename_symbol';
    }

    return NON_WRITE_VISIBLE_TOOL_NAMES.has(toolName);
}

function normalizeApprovalPolicy(
    approvalPolicy: ApprovalPolicy,
): Extract<ApprovalPolicy, typeof SUPPORTED_V1_APPROVAL_POLICIES[number]> {
    if (approvalPolicy === 'strict' || approvalPolicy === 'balanced' || approvalPolicy === 'workspace_auto') {
        return approvalPolicy;
    }

    return 'balanced';
}

function createPolicyBaseline(
    approvalPolicy: Extract<ApprovalPolicy, typeof SUPPORTED_V1_APPROVAL_POLICIES[number]>,
): PolicyBaseline {
    switch (approvalPolicy) {
        case 'strict':
            return {
                defaultMode: 'ask',
                tools: {
                    read: 'allow',
                    list: 'allow',
                    glob: 'allow',
                    grep: 'allow',
                    lsp: 'allow',
                    skill: 'allow',
                    question: 'allow',
                    todoread: 'allow',
                    edit: 'ask',
                    bash: 'ask',
                    webfetch: 'deny',
                    websearch: 'deny',
                    task: 'deny',
                    todowrite: 'ask',
                },
            };
        case 'workspace_auto':
            return {
                defaultMode: 'auto',
                tools: {
                    skill: 'allow',
                    question: 'allow',
                    todoread: 'allow',
                    edit: 'allow',
                    bash: 'ask',
                    webfetch: 'ask',
                    websearch: 'ask',
                    task: 'ask',
                    todowrite: 'allow',
                },
            };
        case 'balanced':
        default:
            return {
                defaultMode: 'auto',
                tools: {
                    skill: 'allow',
                    question: 'allow',
                    todoread: 'allow',
                    edit: 'ask',
                    bash: 'ask',
                    webfetch: 'ask',
                    websearch: 'ask',
                    task: 'ask',
                    todowrite: 'ask',
                },
            };
    }
}
