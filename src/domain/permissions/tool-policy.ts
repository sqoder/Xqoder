import type {
    AgentPermissionMode,
    PermissionSettings,
} from '@xqoder/foundation-shared/types/permissions.js';
import { mergeToolApprovalPatches, type ToolApprovalPatch } from './approval.js';
import {
    classifyReadPathScope,
    classifyWritePathScope,
    resolvePermissionCheckPaths,
    type ReadPathScope,
} from './filesystem-scope.js';
import {
    describeSuspiciousPath,
    isDangerousCommand,
    isPathOutsideProject,
    isProtectedPath,
    isSensitiveConfigPath,
    isSensitiveReadPath,
} from './sensitive-paths.js';

export const TOOL_TO_PERMISSION_KEY: Record<string, string> = {
    read_file: 'read',
    read_any_file: 'read',
    write_file: 'edit',
    edit_file: 'edit',
    preview_diff: 'edit',
    apply_patch: 'edit',
    restore_rollback_point: 'edit',
    run_command: 'bash',
    run_shell: 'bash',
    install_package: 'bash',
    grep_content: 'grep',
    search_code: 'grep',
    glob_files: 'glob',
    list_files: 'list',
    fetch_url: 'webfetch',
    inspect_github_repo: 'webfetch',
    websearch: 'websearch',
    delegate_task: 'task',
    diagnostics: 'read',
    sourcegraph: 'read',
    skill: 'skill',
    discover_skills: 'skill',
    todowrite: 'todowrite',
    todoread: 'todoread',
    question: 'question',
    lsp_rename_symbol: 'edit',
};

export const LSP_TOOL_PERMISSION_KEY = 'lsp';
const VALID_PERMISSION_MODES: AgentPermissionMode[] = [
    'allow',
    'ask',
    'deny',
    'auto',
    'plan',
    'default',
    'bypassPermissions',
];
const READLIKE_TOOLS = new Set([
    'read_file',
    'read_any_file',
    'search_code',
    'grep_content',
    'glob_files',
    'list_files',
    'sourcegraph',
    'diagnostics',
]);
const WRITELIKE_TOOLS = new Set([
    'write_file',
    'edit_file',
    'apply_patch',
    'restore_rollback_point',
    'lsp_rename_symbol',
]);
const NETWORK_TOOLS = new Set([
    'fetch_url',
    'inspect_github_repo',
    'websearch',
]);
const MCP_READONLY_OPERATIONS = new Set<McpToolOperation>([
    'list_prompts',
    'get_prompt',
    'list_resources',
    'read_resource',
]);

export type ToolSecuritySource = 'builtin' | 'mcp';
export type ToolTrustLevel = 'trusted' | 'untrusted';
export type McpToolOperation =
    | 'tool_call'
    | 'list_prompts'
    | 'get_prompt'
    | 'list_resources'
    | 'read_resource';

export interface ToolSecurityPolicyContext {
    source: ToolSecuritySource;
    trust?: ToolTrustLevel;
    serverName?: string;
    operation?: McpToolOperation;
}

type ResolvedMcpSecurityContext = ToolSecurityPolicyContext & {
    source: 'mcp';
    trust: ToolTrustLevel;
    operation: McpToolOperation;
};

export function getPermissionKeyForTool(
    toolName: string,
    securityContext?: ToolSecurityPolicyContext,
): string {
    const mcpOperation = resolveMcpOperation(toolName, securityContext);
    if (mcpOperation) {
        return MCP_READONLY_OPERATIONS.has(mcpOperation) ? 'read' : 'task';
    }

    if (toolName === 'lsp_rename_symbol') {
        return TOOL_TO_PERMISSION_KEY[toolName] ?? 'edit';
    }

    if (toolName.startsWith('lsp_')) {
        return LSP_TOOL_PERMISSION_KEY;
    }

    return TOOL_TO_PERMISSION_KEY[toolName] ?? toolName;
}

export function resolveToolPermissionMode(
    toolName: string,
    permissions: PermissionSettings | undefined,
    securityContext?: ToolSecurityPolicyContext,
): AgentPermissionMode {
    if (!permissions) {
        return 'ask';
    }

    const key = getPermissionKeyForTool(toolName, securityContext);
    const mode = permissions.tools?.[key] ?? permissions.defaultMode ?? 'ask';
    return VALID_PERMISSION_MODES.includes(mode) ? mode : 'ask';
}

export interface ToolPolicyDecisionInput {
    toolName: string;
    args?: Record<string, unknown>;
    permissions: PermissionSettings | undefined;
    hasPriorRead: boolean;
    projectRoot?: string;
    cwd?: string;
    allowedPaths?: string[];
    approvedReadPaths?: string[];
    securityContext?: ToolSecurityPolicyContext;
}

export function resolveToolPermissionDecision(
    input: ToolPolicyDecisionInput,
): AgentPermissionMode {
    const { toolName, permissions } = input;

    // Check disallowedTools
    if (permissions?.disallowedTools?.includes(toolName)) {
        return 'deny';
    }
    const key = getPermissionKeyForTool(toolName, input.securityContext);
    if (permissions?.disallowedTools?.includes(key)) {
        return 'deny';
    }

    const structuredDecision = resolveStructuredPermissionDecision(input);
    if (structuredDecision === 'deny') {
        return 'deny';
    }

    const requiresHardApproval = shouldForceExplicitApproval(input);
    const requiresReadBeforeWriteApproval = shouldRequireReadBeforeWrite(toolName, input.hasPriorRead);
    const explicitlyAllowed = permissions?.allowedTools?.includes(toolName)
        || permissions?.allowedTools?.includes(key);

    if (explicitlyAllowed) {
        return requiresHardApproval || requiresReadBeforeWriteApproval || structuredDecision === 'ask'
            ? 'ask'
            : structuredDecision ?? 'allow';
    }

    let mode = resolveToolPermissionMode(toolName, permissions, input.securityContext);

    if (mode === 'bypassPermissions') {
        return requiresHardApproval || requiresReadBeforeWriteApproval || structuredDecision === 'ask'
            ? 'ask'
            : structuredDecision ?? 'allow';
    }

    if (mode === 'deny') {
        return structuredDecision === 'ask' ? 'ask' : 'deny';
    }

    if (structuredDecision === 'allow') {
        return 'allow';
    }

    if (requiresHardApproval || requiresReadBeforeWriteApproval || structuredDecision === 'ask') {
        return 'ask';
    }

    if (mode === 'auto') {
        return resolveAutoModeDecision(input);
    }

    if (mode === 'plan') {
        if (isMcpReadOnlyOperation(input.securityContext, toolName)) {
            return evaluateToolRisk(toolName, input.args, input.securityContext) === 'low'
                ? 'allow'
                : 'ask';
        }

        return isReadLikeTool(toolName, input.securityContext) && isReadPathAllowedByDefault(input)
            ? 'allow'
            : 'ask';
    }

    if (mode === 'default') {
        // Fallback to ask if mode is literally 'default' but defaultMode is not set
        return 'ask';
    }

    return mode;
}

function resolveAutoModeDecision(input: ToolPolicyDecisionInput): AgentPermissionMode {
    const { toolName, args, securityContext } = input;

    // Deterministic rules
    if (isMcpReadOnlyOperation(securityContext, toolName)) {
        return evaluateToolRisk(toolName, args, securityContext) === 'low' ? 'allow' : 'ask';
    }

    if (isReadLikeTool(toolName, securityContext)) {
        return isReadPathAllowedByDefault(input) ? 'allow' : 'ask';
    }

    if (isWriteLikeTool(toolName)) {
        return isWritePathAllowedByDefault(input) ? 'allow' : 'ask';
    }

    // Basic Risk Classifier
    const risk = evaluateToolRisk(toolName, args, securityContext);
    if (risk === 'low') {
        return 'allow';
    }

    return 'ask';
}

function isWritePathAllowedByDefault(input: ToolPolicyDecisionInput): boolean {
    if (!input.projectRoot || !input.cwd) {
        return false;
    }

    const targetPaths = resolvePolicyTargetPaths(input.toolName, input.args);
    if (targetPaths.length === 0) {
        return false;
    }

    const permissions = input.permissions;
    const approvalPolicy = permissions?.approvalPolicy;
    if (approvalPolicy !== 'workspace_auto') {
        return false;
    }

    return targetPaths.every((targetPath) => {
        const suspiciousPathReason = describeSuspiciousPath(targetPath);
        if (suspiciousPathReason) {
            return false;
        }

        const writeScope = classifyWritePathScope(targetPath, {
            cwd: input.cwd!,
            projectRoot: input.projectRoot!,
            allowedPaths: input.allowedPaths,
        });

        if (writeScope === 'internal') {
            return true;
        }

        if (writeScope !== 'workspace') {
            return false;
        }

        return !isProtectedPath(targetPath) && !isSensitiveConfigPath(targetPath);
    });
}

function hasSuspiciousTargetPath(input: ToolPolicyDecisionInput): boolean {
    return resolvePolicyTargetPaths(input.toolName, input.args)
        .some((targetPath) => Boolean(describeSuspiciousPath(targetPath)));
}

function allowsReadFromEditPermission(input: ToolPolicyDecisionInput): boolean {
    if (!isReadLikeTool(input.toolName, input.securityContext)) {
        return false;
    }

    const permissions = input.permissions;
    if (!permissions) {
        return false;
    }

    if (permissions.allowedTools?.includes('write_file') || permissions.allowedTools?.includes('edit') || permissions.allowedTools?.includes('edit_file')) {
        return true;
    }

    const editMode = permissions.tools?.['edit'];
    return editMode === 'allow' || editMode === 'bypassPermissions';
}

function isReadAskConfigured(input: ToolPolicyDecisionInput): boolean {
    if (!isReadLikeTool(input.toolName, input.securityContext)) {
        return false;
    }

    const key = getPermissionKeyForTool(input.toolName, input.securityContext);
    return input.permissions?.tools?.[key] === 'ask';
}

function isReadDenyConfigured(input: ToolPolicyDecisionInput): boolean {
    if (!isReadLikeTool(input.toolName, input.securityContext)) {
        return false;
    }

    const key = getPermissionKeyForTool(input.toolName, input.securityContext);
    return input.permissions?.tools?.[key] === 'deny';
}

function isWriteAskConfigured(input: ToolPolicyDecisionInput): boolean {
    if (!isWriteLikeTool(input.toolName)) {
        return false;
    }

    const key = getPermissionKeyForTool(input.toolName, input.securityContext);
    return input.permissions?.tools?.[key] === 'ask';
}

function isWriteDenyConfigured(input: ToolPolicyDecisionInput): boolean {
    if (!isWriteLikeTool(input.toolName)) {
        return false;
    }

    const key = getPermissionKeyForTool(input.toolName, input.securityContext);
    return input.permissions?.tools?.[key] === 'deny';
}

function hasInternalWritableTarget(input: ToolPolicyDecisionInput): boolean {
    if (!input.projectRoot || !input.cwd || !isWriteLikeTool(input.toolName)) {
        return false;
    }

    const targetPaths = resolvePolicyTargetPaths(input.toolName, input.args);
    return targetPaths.length > 0 && targetPaths.every((targetPath) => classifyWritePathScope(targetPath, {
        cwd: input.cwd!,
        projectRoot: input.projectRoot!,
        allowedPaths: input.allowedPaths,
    }) === 'internal');
}

function hasHighRiskWriteTarget(input: ToolPolicyDecisionInput): boolean {
    if (!isWriteLikeTool(input.toolName)) {
        return false;
    }

    return resolvePolicyTargetPaths(input.toolName, input.args)
        .some((targetPath) => Boolean(describeSuspiciousPath(targetPath)) || isProtectedPath(targetPath) || isSensitiveConfigPath(targetPath));
}

function isOutsideWriteTarget(input: ToolPolicyDecisionInput): boolean {
    if (!input.projectRoot || !input.cwd || !isWriteLikeTool(input.toolName)) {
        return false;
    }

    const targetPaths = resolvePolicyTargetPaths(input.toolName, input.args);
    return targetPaths.some((targetPath) => classifyWritePathScope(targetPath, {
        cwd: input.cwd!,
        projectRoot: input.projectRoot!,
        allowedPaths: input.allowedPaths,
    }) === 'outside');
}

function resolveReadPermissionDecision(input: ToolPolicyDecisionInput): AgentPermissionMode | undefined {
    if (!isReadLikeTool(input.toolName, input.securityContext)) {
        return undefined;
    }

    if (hasSuspiciousTargetPath(input)) {
        return 'ask';
    }

    if (isReadDenyConfigured(input)) {
        return 'deny';
    }

    if (isReadAskConfigured(input)) {
        return 'ask';
    }

    if (allowsReadFromEditPermission(input)) {
        return 'allow';
    }

    if (isReadPathAllowedByDefault(input)) {
        return 'allow';
    }

    return undefined;
}

function resolveWritePermissionDecision(input: ToolPolicyDecisionInput): AgentPermissionMode | undefined {
    if (!isWriteLikeTool(input.toolName)) {
        return undefined;
    }

    if (isWriteDenyConfigured(input)) {
        return 'deny';
    }

    if (hasInternalWritableTarget(input)) {
        return 'allow';
    }

    if (hasHighRiskWriteTarget(input)) {
        return 'ask';
    }

    if (isWriteAskConfigured(input)) {
        return 'ask';
    }

    if (isWritePathAllowedByDefault(input)) {
        return 'allow';
    }

    if (isOutsideWriteTarget(input)) {
        return 'ask';
    }

    return undefined;
}

function resolveStructuredPermissionDecision(input: ToolPolicyDecisionInput): AgentPermissionMode | undefined {
    return resolveReadPermissionDecision(input) ?? resolveWritePermissionDecision(input);
}

type ToolRisk = 'low' | 'medium' | 'high';

function evaluateToolRisk(
    toolName: string,
    args?: Record<string, unknown>,
    securityContext?: ToolSecurityPolicyContext,
): ToolRisk {
    const mcpContext = resolveMcpSecurityContextForPolicy(toolName, securityContext);
    if (mcpContext) {
        if (mcpContext.trust === 'untrusted') {
            return 'high';
        }

        return isMcpReadOnlyOperation(mcpContext, toolName) ? 'low' : 'medium';
    }

    if (isReadLikeTool(toolName, securityContext)) return 'low';

    if (toolName === 'run_command' || toolName === 'run_shell') {
        const command = typeof args?.['command'] === 'string' ? args['command'] : '';
        if (isDangerousCommand(command)) return 'high';
        // Basic classification: common safe-ish commands could be low risk,
        // but for now we default to medium for any shell command.
        return 'medium';
    }

    if (isWriteLikeTool(toolName)) {
        const path = typeof args?.['path'] === 'string' ? args['path'] : '';
        if (isSensitiveConfigPath(path)) return 'high';
        return 'medium';
    }

    // Default to medium for other tools
    return 'medium';
}

function isReadLikeToolWithContext(
    toolName: string,
    securityContext?: ToolSecurityPolicyContext,
): boolean {
    return READLIKE_TOOLS.has(toolName)
        || (toolName.startsWith('lsp_') && toolName !== 'lsp_rename_symbol')
        || isMcpReadOnlyOperation(securityContext, toolName);
}

export function isReadLikeTool(
    toolName: string,
    securityContext?: ToolSecurityPolicyContext,
): boolean {
    return isReadLikeToolWithContext(toolName, securityContext);
}

export function isWriteLikeTool(toolName: string): boolean {
    return WRITELIKE_TOOLS.has(toolName);
}

export function requiresCheckpointBeforeTool(toolName: string): boolean {
    return isWriteLikeTool(toolName);
}

export function shouldTriggerVerifierAfterTool(toolName: string): boolean {
    return isWriteLikeTool(toolName);
}

export function shouldRequireReadBeforeWrite(toolName: string, hasPriorRead: boolean): boolean {
    return isWriteLikeTool(toolName) && !hasPriorRead;
}

export function createToolPolicyApprovalPatch(
    input: ToolPolicyDecisionInput & {
        permissionMode?: AgentPermissionMode;
        hasNativeApprovalRequest?: boolean;
    },
): ToolApprovalPatch | undefined {
    const targetPaths = resolvePolicyTargetPaths(input.toolName, input.args);
    const targetPath = targetPaths[0];
    const builtInReadAccess = isBuiltInReadAccessTool(input.toolName, input.securityContext);
    const outsideWorkspaceReadTargetPath = builtInReadAccess
        ? resolveOutsideWorkspaceReadTargetPath(input)
        : undefined;
    const protectedReadTargetPath = builtInReadAccess
        ? resolveProtectedReadTargetPath(input)
        : undefined;
    const sensitiveReadTargetPath = builtInReadAccess
        ? resolveSensitiveReadTargetPath(input)
        : undefined;
    const outsideProjectWriteTargetPath = builtInReadAccess
        ? undefined
        : targetPaths.find((candidate) => isPathOutsideProject(candidate, input.projectRoot));
    const protectedWriteTargetPath = builtInReadAccess
        ? undefined
        : targetPaths.find((candidate) => isProtectedPath(candidate));
    const suspiciousTargetPath = targetPaths.find((candidate) => Boolean(describeSuspiciousPath(candidate)));
    const highRiskConfigTargetPath = isWriteLikeTool(input.toolName)
        ? targetPaths.find((candidate) => isSensitiveConfigPath(candidate))
        : undefined;
    const nonBuiltInSensitiveRead = !builtInReadAccess && requiresSensitiveReadApproval(input.toolName, input.args);
    let approvalPatch: ToolApprovalPatch | undefined;

    if (protectedReadTargetPath) {
        approvalPatch = mergeToolApprovalPatches(approvalPatch, {
            force: true,
            category: 'protected-path',
            summary: `Request access to protected path: ${protectedReadTargetPath}`,
            reason: 'This read targets shell startup files, version-control metadata, local credentials, or agent configuration and requires explicit approval.',
            preview: buildReadScopePreview(input, protectedReadTargetPath),
            risk: 'high',
        });
    }

    if (sensitiveReadTargetPath) {
        approvalPatch = mergeToolApprovalPatches(approvalPatch, {
            force: true,
            category: 'sensitive-read',
            summary: `Request read of sensitive file: ${sensitiveReadTargetPath}`,
            reason: 'This read may expose local credentials, shell config, agent settings, or machine identity material and requires explicit approval.',
            preview: buildReadScopePreview(input, sensitiveReadTargetPath),
            risk: 'high',
        });
    }

    if (outsideWorkspaceReadTargetPath) {
        approvalPatch = mergeToolApprovalPatches(approvalPatch, {
            force: true,
            category: 'outside-workspace-read',
            summary: `Request read outside workspace: ${outsideWorkspaceReadTargetPath}`,
            reason: 'This read targets a path outside the current workspace and requires explicit approval.',
            preview: buildReadScopePreview(input, outsideWorkspaceReadTargetPath),
            risk: 'medium',
            suggestion: 'If this path should be readable without repeated prompts, add its directory to allowed read paths.',
        });
    }

    if (outsideProjectWriteTargetPath) {
        approvalPatch = mergeToolApprovalPatches(approvalPatch, {
            force: true,
            category: 'high-risk-write',
            summary: `Request access to path outside project: ${outsideProjectWriteTargetPath}`,
            reason: 'This operation targets a path outside the current project root and requires explicit approval.',
            preview: [
                `projectRoot: ${input.projectRoot ?? '(unknown)'}`,
                `targetPath: ${outsideProjectWriteTargetPath}`,
            ].join('\n'),
            risk: 'high',
            suggestion: 'If this directory should be writable, add it explicitly or use a mode that permits the edit scope you intend.',
        });
    }

    if (protectedWriteTargetPath) {
        approvalPatch = mergeToolApprovalPatches(approvalPatch, {
            force: true,
            category: 'protected-path',
            summary: isWriteLikeTool(input.toolName)
                ? `Request write to protected path: ${protectedWriteTargetPath}`
                : `Request access to protected path: ${protectedWriteTargetPath}`,
            reason: 'Writes or direct access to version-control metadata, local credentials, shell startup files, or agent configuration require explicit approval.',
            preview: [
                `tool: ${input.toolName}`,
                `projectRoot: ${input.projectRoot ?? '(unknown)'}`,
                `targetPath: ${protectedWriteTargetPath}`,
            ].join('\n'),
            risk: 'high',
        });
    }

    if (highRiskConfigTargetPath) {
        approvalPatch = mergeToolApprovalPatches(approvalPatch, {
            force: true,
            category: 'high-risk-write',
            summary: `Request write to high-risk config path: ${highRiskConfigTargetPath}`,
            reason: 'This operation modifies project configuration or environment files and requires explicit approval.',
            preview: [
                `tool: ${input.toolName}`,
                `projectRoot: ${input.projectRoot ?? '(unknown)'}`,
                `targetPath: ${highRiskConfigTargetPath}`,
            ].join('\n'),
            risk: 'high',
        });
    }

    if (nonBuiltInSensitiveRead) {
        approvalPatch = mergeToolApprovalPatches(approvalPatch, {
            force: true,
            category: 'sensitive-read',
            summary: targetPath
                ? `Request access to sensitive file: ${targetPath}`
                : `Request access to sensitive data via ${input.toolName}`,
            reason: 'This operation may read secrets, credentials, or local machine identity material and requires explicit approval.',
            preview: buildSensitiveReadPreview(input, targetPath),
            risk: 'high',
        });
    }

    const externalToolPatch = createExternalToolApprovalPatch(input);
    if (externalToolPatch) {
        approvalPatch = mergeToolApprovalPatches(approvalPatch, externalToolPatch);
    }

    const readBeforeWritePatch = createReadBeforeWriteApprovalPatch(
        input,
        targetPath,
        approvalPatch !== undefined,
    );
    if (readBeforeWritePatch) {
        approvalPatch = mergeToolApprovalPatches(approvalPatch, readBeforeWritePatch);
    }

    if (suspiciousTargetPath) {
        return mergeToolApprovalPatches(undefined, {
            force: true,
            category: 'suspicious-path',
            summary: `Request access to suspicious path: ${suspiciousTargetPath}`,
            reason: `This operation targets a suspicious path pattern (${describeSuspiciousPath(suspiciousTargetPath)}) and requires explicit approval.`,
            preview: [
                `tool: ${input.toolName}`,
                `projectRoot: ${input.projectRoot ?? '(unknown)'}`,
                `targetPath: ${suspiciousTargetPath}`,
            ].join('\n'),
            risk: 'high',
        });
    }

    if (approvalPatch) {
        return approvalPatch;
    }

    if (input.permissionMode !== 'ask' || input.hasNativeApprovalRequest) {
        return undefined;
    }

    return {
        force: true,
        summary: `Permission policy requires approval before running ${input.toolName}`,
        reason: 'The active permission policy requires explicit approval before this tool can run.',
        preview: buildGenericApprovalPreview(input, targetPath),
        risk: isReadLikeTool(input.toolName, input.securityContext) ? 'medium' : 'high',
    };
}

function shouldForceExplicitApproval(input: ToolPolicyDecisionInput): boolean {
    const builtInReadAccess = isBuiltInReadAccessTool(input.toolName, input.securityContext);
    if (builtInReadAccess) {
        return resolveProtectedReadTargetPath(input) !== undefined
            || resolveSensitiveReadTargetPath(input) !== undefined
            || resolveOutsideWorkspaceReadTargetPath(input) !== undefined;
    }

    return requiresOutsideProjectApproval(input)
        || requiresProtectedPathApproval(input)
        || requiresExternalToolApproval(input)
        || requiresNetworkApproval(input.toolName)
        || requiresSensitiveReadApproval(input.toolName, input.args)
        || requiresDangerousCommandApproval(input.toolName, input.args)
        || requiresHighRiskConfigWriteApproval(input.toolName, input.args);
}

function resolveReadTargetPath(input: ToolPolicyDecisionInput): string | undefined {
    if (!isReadLikeTool(input.toolName, input.securityContext)) {
        return undefined;
    }

    return resolvePolicyTargetPath(input.toolName, input.args);
}

function resolveReadTargetScope(input: ToolPolicyDecisionInput): ReadPathScope | undefined {
    const targetPath = resolveReadTargetPath(input);
    if (!targetPath || !input.projectRoot || !input.cwd) {
        return undefined;
    }

    return classifyReadPathScope(targetPath, {
        cwd: input.cwd,
        projectRoot: input.projectRoot,
        allowedPaths: input.allowedPaths,
    });
}

function resolveOutsideWorkspaceReadTargetPath(input: ToolPolicyDecisionInput): string | undefined {
    const targetPath = resolveReadTargetPath(input);
    const scope = resolveReadTargetScope(input);
    return targetPath && scope === 'outside' && !isReadTargetSessionApproved(input)
        ? targetPath
        : undefined;
}

function resolveSensitiveReadTargetPath(input: ToolPolicyDecisionInput): string | undefined {
    if (isMcpReadOnlyOperation(input.securityContext, input.toolName)) {
        return undefined;
    }

    const targetPath = resolveReadTargetPath(input);
    if (!targetPath) {
        return undefined;
    }

    return isSensitiveReadPath(targetPath) ? targetPath : undefined;
}

function resolveProtectedReadTargetPath(input: ToolPolicyDecisionInput): string | undefined {
    if (isMcpReadOnlyOperation(input.securityContext, input.toolName)) {
        return undefined;
    }

    const targetPath = resolveReadTargetPath(input);
    if (!targetPath) {
        return undefined;
    }

    return isProtectedPath(targetPath) ? targetPath : undefined;
}

function isReadPathAllowedByDefault(input: ToolPolicyDecisionInput): boolean {
    if (!input.projectRoot || !input.cwd) {
        return false;
    }

    const targetPath = resolveReadTargetPath(input);
    if (!targetPath) {
        return true;
    }

    const scope = resolveReadTargetScope(input);
    if (!scope) {
        return false;
    }

    if (resolveProtectedReadTargetPath(input) || resolveSensitiveReadTargetPath(input)) {
        return false;
    }

    return scope === 'outside' ? isReadTargetSessionApproved(input) : true;
}

function isReadTargetSessionApproved(input: ToolPolicyDecisionInput): boolean {
    const targetPath = resolveReadTargetPath(input);
    if (!targetPath || !input.cwd || !input.approvedReadPaths?.length) {
        return false;
    }

    const targetCandidates = new Set(resolvePermissionCheckPaths(targetPath, { cwd: input.cwd }));
    return input.approvedReadPaths.some((approvedPath) => {
        for (const candidate of resolvePermissionCheckPaths(approvedPath, { cwd: input.cwd! })) {
            if (targetCandidates.has(candidate)) {
                return true;
            }
        }
        return false;
    });
}

function describeReadPathScope(scope: ReadPathScope): string {
    switch (scope) {
        case 'workspace':
            return 'workspace';
        case 'allowed':
            return 'allowed path';
        case 'internal':
            return 'internal runtime path';
        case 'outside':
        default:
            return 'outside workspace';
    }
}

function buildReadScopePreview(
    input: ToolPolicyDecisionInput,
    targetPath: string,
): string {
    const scope = resolveReadTargetScope(input);
    return [
        `projectRoot: ${input.projectRoot ?? '(unknown)'}`,
        `cwd: ${input.cwd ?? '(unknown)'}`,
        `targetPath: ${targetPath}`,
        `scope: ${scope ? describeReadPathScope(scope) : '(unknown)'}`,
    ].join('\n');
}

function buildSensitiveReadPreview(input: ToolPolicyDecisionInput, targetPath: string | undefined): string {
    if (targetPath) {
        return isReadLikeTool(input.toolName, input.securityContext)
            ? buildReadScopePreview(input, targetPath)
            : [
                `tool: ${input.toolName}`,
                `targetPath: ${targetPath}`,
            ].join('\n');
    }

    const command = typeof input.args?.['command'] === 'string' ? input.args['command'] : undefined;
    return command
        ? [
            `tool: ${input.toolName}`,
            `command: ${command}`,
        ].join('\n')
        : `tool: ${input.toolName}`;
}

function isBuiltInReadAccessTool(
    toolName: string,
    securityContext?: ToolSecurityPolicyContext,
): boolean {
    return !toolName.startsWith('mcp.')
        && securityContext?.source !== 'mcp'
        && isReadLikeTool(toolName, securityContext);
}

function requiresNetworkApproval(toolName: string): boolean {
    return NETWORK_TOOLS.has(toolName);
}

function requiresSensitiveReadApproval(
    toolName: string,
    args: Record<string, unknown> | undefined,
): boolean {
    if (toolName === 'run_shell' || toolName === 'run_command') {
        const command = typeof args?.['command'] === 'string' ? args['command'] : '';
        return isSensitiveShellReadCommand(command);
    }

    if (!isReadLikeTool(toolName)) {
        return false;
    }

    const targetPath = resolvePolicyTargetPath(toolName, args);
    return Boolean(targetPath && isSensitiveReadPath(targetPath));
}

function isSensitiveShellReadCommand(command: string): boolean {
    const normalized = command.trim();
    if (!normalized) {
        return false;
    }

    if (/(?:^|[|;&(]\s*)(?:printenv|env)(?:\s|$)/i.test(normalized)) {
        return true;
    }

    if (/\$[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|ACCESS_KEY|AUTH)/i.test(normalized)) {
        return true;
    }

    const matches = normalized.match(/(?:~\/|\.{1,2}\/|\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*/g) ?? [];
    return matches.some((candidate) => looksLikeSensitivePathCandidate(candidate) && isSensitiveReadPath(candidate));
}

function looksLikeSensitivePathCandidate(candidate: string): boolean {
    return candidate.includes('/')
        || candidate.startsWith('.')
        || /^id_(?:rsa|dsa|ecdsa|ed25519)$/i.test(candidate)
        || /\.(?:env|pem|key|p12|pfx|crt)$/i.test(candidate);
}

function buildGenericApprovalPreview(
    input: ToolPolicyDecisionInput,
    targetPath: string | undefined,
): string {
    if (targetPath) {
        return [
            `projectRoot: ${input.projectRoot ?? '(unknown)'}`,
            `targetPath: ${targetPath}`,
        ].join('\n');
    }

    try {
        return JSON.stringify(input.args ?? {}, null, 2);
    } catch {
        return '[unserializable tool arguments]';
    }
}

function createReadBeforeWriteApprovalPatch(
    input: ToolPolicyDecisionInput & {
        hasNativeApprovalRequest?: boolean;
    },
    targetPath: string | undefined,
    hasExistingPatch: boolean,
): ToolApprovalPatch | undefined {
    if (!shouldRequireReadBeforeWrite(input.toolName, input.hasPriorRead)) {
        return undefined;
    }

    return {
        force: true,
        category: 'high-risk-write',
        ...(!input.hasNativeApprovalRequest && !hasExistingPatch
            ? {
                summary: targetPath
                    ? `Review write before prior read: ${targetPath}`
                    : `Review ${input.toolName} before prior read`,
            }
            : {}),
        reason: 'This write request arrived before the agent read any project context in the current session and now requires explicit approval.',
        preview: buildReadBeforeWritePreview(input, targetPath),
        risk: 'high',
    };
}

function buildReadBeforeWritePreview(
    input: ToolPolicyDecisionInput,
    targetPath: string | undefined,
): string {
    if (targetPath) {
        return [
            `projectRoot: ${input.projectRoot ?? '(unknown)'}`,
            `targetPath: ${targetPath}`,
            'hasPriorRead: false',
        ].join('\n');
    }

    const genericPreview = buildGenericApprovalPreview(input, targetPath);
    return `${genericPreview}\nhasPriorRead: false`;
}

function createExternalToolApprovalPatch(
    input: ToolPolicyDecisionInput & {
        hasNativeApprovalRequest?: boolean;
    },
): ToolApprovalPatch | undefined {
    if (!requiresExternalToolApproval(input)) {
        return undefined;
    }

    const securityContext = resolveMcpSecurityContextForPolicy(input.toolName, input.securityContext);
    if (!securityContext) {
        return undefined;
    }

    const summary = input.hasNativeApprovalRequest
        ? undefined
        : buildExternalToolSummary(input.toolName, securityContext);

    return {
        force: true,
        category: 'external-tool',
        ...(summary ? { summary } : {}),
        reason: buildExternalToolReason(securityContext),
        preview: buildExternalToolPreview(input, securityContext),
        risk: securityContext.trust === 'untrusted' ? 'high' : 'medium',
    };
}

function buildExternalToolSummary(
    toolName: string,
    securityContext: ToolSecurityPolicyContext,
): string {
    const serverName = securityContext.serverName ?? 'unknown';

    switch (securityContext.operation) {
        case 'list_prompts':
            return `List MCP prompts @ ${serverName}`;
        case 'get_prompt':
            return `Read MCP prompt @ ${serverName}`;
        case 'list_resources':
            return `List MCP resources @ ${serverName}`;
        case 'read_resource':
            return `Read MCP resource @ ${serverName}`;
        case 'tool_call':
        default:
            return `Call MCP tool ${toolName} @ ${serverName}`;
    }
}

function buildExternalToolReason(securityContext: ToolSecurityPolicyContext): string {
    if (securityContext.trust === 'untrusted') {
        return 'This operation targets an untrusted MCP server and requires explicit approval before external data or tools are accessed.';
    }

    return 'This operation invokes an MCP tool on a trusted MCP server and still requires explicit approval because MCP tool calls may have side effects outside the current workspace.';
}

function buildExternalToolPreview(
    input: ToolPolicyDecisionInput,
    securityContext: ToolSecurityPolicyContext,
): string {
    const lines = [
        `tool: ${input.toolName}`,
        `server: ${securityContext.serverName ?? '(unknown)'}`,
        `trust: ${securityContext.trust ?? 'untrusted'}`,
        `operation: ${securityContext.operation ?? 'tool_call'}`,
    ];
    const argsPreview = safeStringifyArgs(input.args);

    if (argsPreview) {
        lines.push('args:');
        lines.push(argsPreview);
    }

    return lines.join('\n');
}

function safeStringifyArgs(args: Record<string, unknown> | undefined): string {
    if (!args || Object.keys(args).length === 0) {
        return '';
    }

    try {
        return JSON.stringify(args, null, 2);
    } catch {
        return '[unserializable tool arguments]';
    }
}

function requiresDangerousCommandApproval(
    toolName: string,
    args: Record<string, unknown> | undefined,
): boolean {
    if (toolName !== 'run_shell' && toolName !== 'run_command') {
        return false;
    }
    const command = typeof args?.['command'] === 'string' ? args['command'] : '';
    return isDangerousCommand(command);
}

function requiresHighRiskConfigWriteApproval(
    toolName: string,
    args: Record<string, unknown> | undefined,
): boolean {
    if (toolName !== 'write_file' && toolName !== 'edit_file' && toolName !== 'apply_patch') {
        return false;
    }

    return resolvePolicyTargetPaths(toolName, args).some((targetPath) => isSensitiveConfigPath(targetPath));
}

function requiresOutsideProjectApproval(input: ToolPolicyDecisionInput): boolean {
    return resolvePolicyTargetPaths(input.toolName, input.args)
        .some((targetPath) => isPathOutsideProject(targetPath, input.projectRoot));
}

function requiresProtectedPathApproval(input: ToolPolicyDecisionInput): boolean {
    return resolvePolicyTargetPaths(input.toolName, input.args)
        .some((targetPath) => isProtectedPath(targetPath));
}

function requiresExternalToolApproval(input: ToolPolicyDecisionInput): boolean {
    const securityContext = resolveMcpSecurityContextForPolicy(input.toolName, input.securityContext);
    if (!securityContext) {
        return false;
    }

    if (securityContext.trust === 'untrusted') {
        return true;
    }

    return securityContext.operation === 'tool_call';
}

export function isMcpReadOnlyOperation(
    securityContext: ToolSecurityPolicyContext | undefined,
    toolName?: string,
): boolean {
    const operation = resolveMcpOperation(toolName ?? '', securityContext);
    return operation !== undefined && MCP_READONLY_OPERATIONS.has(operation);
}

function isMcpToolSecurityContext(
    securityContext: ToolSecurityPolicyContext | undefined,
): securityContext is ToolSecurityPolicyContext & { source: 'mcp' } {
    return securityContext?.source === 'mcp';
}

function resolveMcpOperation(
    toolName: string,
    securityContext: ToolSecurityPolicyContext | undefined,
): McpToolOperation | undefined {
    if (isMcpToolSecurityContext(securityContext)) {
        return securityContext.operation ?? inferMcpToolOperation(toolName) ?? 'tool_call';
    }

    return inferMcpToolOperation(toolName);
}

function resolveMcpSecurityContextForPolicy(
    toolName: string,
    securityContext: ToolSecurityPolicyContext | undefined,
): ResolvedMcpSecurityContext | undefined {
    const operation = resolveMcpOperation(toolName, securityContext);

    if (isMcpToolSecurityContext(securityContext)) {
        return {
            ...securityContext,
            trust: securityContext.trust ?? 'untrusted',
            operation: operation ?? 'tool_call',
            ...(securityContext.serverName
                ? {}
                : { serverName: inferMcpServerName(toolName) }),
        };
    }

    if (!toolName.startsWith('mcp.')) {
        return undefined;
    }

    return {
        source: 'mcp',
        trust: 'untrusted',
        operation: operation ?? 'tool_call',
        serverName: inferMcpServerName(toolName),
    };
}

function inferMcpServerName(toolName: string): string {
    const [, serverName] = toolName.split('.');
    return serverName?.trim() || 'unknown';
}

function inferMcpToolOperation(toolName: string): McpToolOperation | undefined {
    if (!toolName.startsWith('mcp.')) {
        return undefined;
    }

    if (toolName.endsWith('.resources.list')) {
        return 'list_resources';
    }

    if (toolName.endsWith('.resources.read')) {
        return 'read_resource';
    }

    if (toolName.endsWith('.prompts.list')) {
        return 'list_prompts';
    }

    if (toolName.endsWith('.prompts.get')) {
        return 'get_prompt';
    }

    return 'tool_call';
}

function resolvePolicyTargetPath(
    toolName: string,
    args: Record<string, unknown> | undefined,
): string | undefined {
    return resolvePolicyTargetPaths(toolName, args)[0];
}

function resolvePolicyTargetPaths(
    toolName: string,
    args: Record<string, unknown> | undefined,
): string[] {
    if (toolName === 'run_command' || toolName === 'run_shell') {
        return typeof args?.['cwd'] === 'string' ? [args['cwd']] : [];
    }

    if (toolName === 'apply_patch') {
        return typeof args?.['patch'] === 'string' ? resolvePatchTargetPaths(args['patch']) : [];
    }

    if (typeof args?.['path'] === 'string') {
        return [args['path']];
    }

    if (typeof args?.['file_path'] === 'string') {
        return [args['file_path']];
    }

    return [];
}

function resolvePatchTargetPaths(patch: string): string[] {
    const targetPaths = new Set<string>();

    for (const line of patch.split('\n')) {
        if (line.startsWith('+++ ') || line.startsWith('--- ')) {
            const rawPath = line.slice(4).trim();
            if (rawPath && rawPath !== '/dev/null') {
                targetPaths.add(stripPatchPrefix(rawPath));
            }
            continue;
        }

        const gitDiffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (gitDiffMatch?.[2]) {
            targetPaths.add(gitDiffMatch[2]);
            continue;
        }

        const applyPatchMatch = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
        if (applyPatchMatch?.[1]) {
            targetPaths.add(applyPatchMatch[1].trim());
        }
    }

    return Array.from(targetPaths).filter(Boolean);
}

function stripPatchPrefix(value: string): string {
    if (value.startsWith('a/') || value.startsWith('b/')) {
        return value.slice(2);
    }

    return value;
}
