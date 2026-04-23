import type {
    AgentPermissionMode,
    PermissionSettings,
} from '@xqoder/foundation-shared/types/permissions.js';
import type { ToolApprovalPatch } from './approval.js';
import {
    isDangerousCommand,
    isPathOutsideProject,
    isSensitiveConfigPath,
    isSensitiveReadPath,
} from './sensitive-paths.js';

export const TOOL_TO_PERMISSION_KEY: Record<string, string> = {
    read_file: 'read',
    write_file: 'edit',
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
    'search_code',
    'grep_content',
    'glob_files',
    'list_files',
    'sourcegraph',
    'diagnostics',
]);
const WRITELIKE_TOOLS = new Set([
    'write_file',
    'apply_patch',
    'restore_rollback_point',
    'lsp_rename_symbol',
]);
const NETWORK_TOOLS = new Set([
    'fetch_url',
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

    const requiresHardApproval = shouldForceExplicitApproval(input);
    const explicitlyAllowed = permissions?.allowedTools?.includes(toolName)
        || permissions?.allowedTools?.includes(key);

    if (explicitlyAllowed) {
        return requiresHardApproval ? 'ask' : 'allow';
    }

    let mode = resolveToolPermissionMode(toolName, permissions, input.securityContext);

    if (mode === 'bypassPermissions') {
        return requiresHardApproval ? 'ask' : 'allow';
    }

    if (mode === 'deny') {
        return 'deny';
    }

    if (requiresHardApproval) {
        return 'ask';
    }

    if (mode === 'auto') {
        return resolveAutoModeDecision(input);
    }

    if (mode === 'plan') {
        return isReadLikeTool(toolName, input.securityContext) ? 'allow' : 'ask';
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
    if (isReadLikeTool(toolName, securityContext)) {
        return 'allow';
    }

    // Basic Risk Classifier
    const risk = evaluateToolRisk(toolName, args, securityContext);
    if (risk === 'low') {
        return 'allow';
    }

    return 'ask';
}

type ToolRisk = 'low' | 'medium' | 'high';

function evaluateToolRisk(
    toolName: string,
    args?: Record<string, unknown>,
    securityContext?: ToolSecurityPolicyContext,
): ToolRisk {
    if (isMcpToolSecurityContext(securityContext)) {
        if (securityContext.trust === 'untrusted') {
            return 'high';
        }

        return isMcpReadOnlyOperation(securityContext) ? 'low' : 'medium';
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
    const targetPath = resolvePolicyTargetPath(input.toolName, input.args);
    if (targetPath && isPathOutsideProject(targetPath, input.projectRoot)) {
        return {
            force: true,
            summary: `Request access to path outside project: ${targetPath}`,
            reason: 'This operation targets a path outside the current project root and requires explicit approval.',
            preview: [
                `projectRoot: ${input.projectRoot ?? '(unknown)'}`,
                `targetPath: ${targetPath}`,
            ].join('\n'),
            risk: 'high',
        };
    }

    if (requiresSensitiveReadApproval(input.toolName, input.args)) {
        return {
            force: true,
            summary: targetPath
                ? `Request access to sensitive file: ${targetPath}`
                : `Request access to sensitive data via ${input.toolName}`,
            reason: 'This operation may read secrets, credentials, or local machine identity material and requires explicit approval.',
            preview: buildSensitiveReadPreview(input, targetPath),
            risk: 'high',
        };
    }

    const externalToolPatch = createExternalToolApprovalPatch(input);
    if (externalToolPatch) {
        return externalToolPatch;
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
    return requiresOutsideProjectApproval(input)
        || requiresExternalToolApproval(input)
        || requiresNetworkApproval(input.toolName)
        || requiresSensitiveReadApproval(input.toolName, input.args)
        || requiresDangerousCommandApproval(input.toolName, input.args)
        || requiresHighRiskConfigWriteApproval(input.toolName, input.args);
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

function buildSensitiveReadPreview(
    input: ToolPolicyDecisionInput,
    targetPath: string | undefined,
): string {
    if (targetPath) {
        return [
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

function createExternalToolApprovalPatch(
    input: ToolPolicyDecisionInput & {
        hasNativeApprovalRequest?: boolean;
    },
): ToolApprovalPatch | undefined {
    if (!requiresExternalToolApproval(input)) {
        return undefined;
    }

    const securityContext = input.securityContext;
    if (!isMcpToolSecurityContext(securityContext)) {
        return undefined;
    }

    const summary = input.hasNativeApprovalRequest
        ? undefined
        : buildExternalToolSummary(input.toolName, securityContext);

    return {
        force: true,
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
    if (toolName !== 'write_file' && toolName !== 'apply_patch') {
        return false;
    }

    const targetPath = typeof args?.['path'] === 'string'
        ? args['path']
        : typeof args?.['file_path'] === 'string'
            ? args['file_path']
            : '';
    return targetPath.length > 0 && isSensitiveConfigPath(targetPath);
}

function requiresOutsideProjectApproval(input: ToolPolicyDecisionInput): boolean {
    const targetPath = resolvePolicyTargetPath(input.toolName, input.args);
    return Boolean(targetPath && isPathOutsideProject(targetPath, input.projectRoot));
}

function requiresExternalToolApproval(input: ToolPolicyDecisionInput): boolean {
    const securityContext = input.securityContext;
    if (!isMcpToolSecurityContext(securityContext)) {
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
        return securityContext.operation ?? inferMcpToolOperation(toolName);
    }

    return inferMcpToolOperation(toolName);
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
    if (toolName === 'run_command' || toolName === 'run_shell') {
        return typeof args?.['cwd'] === 'string' ? args['cwd'] : undefined;
    }

    if (typeof args?.['path'] === 'string') {
        return args['path'];
    }

    if (typeof args?.['file_path'] === 'string') {
        return args['file_path'];
    }

    return undefined;
}
