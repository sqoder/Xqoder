import { describe, expect, it } from 'bun:test';
import {
    createApprovalRequestedRecord,
    createApprovalResolvedRecord,
    createScopedPermissionSettings,
    createToolApprovalPrompt,
    createToolPolicyApprovalPatch,
    getPermissionKeyForTool,
    isToolVisibleForExecutionCapability,
    mergeToolApprovalPatches,
    mergeToolApprovalRequest,
    requiresCheckpointBeforeTool,
    resolveV1ApprovalPolicy,
    resolveToolPermissionMode,
    resolveToolPermissionDecision,
    shouldRequireReadBeforeWrite,
    shouldTriggerVerifierAfterTool,
} from '../src/domain/permissions/index.js';

describe('domain tool permission policy', () => {
    it('maps tool names to stable permission keys', () => {
        expect(getPermissionKeyForTool('read_file')).toBe('read');
        expect(getPermissionKeyForTool('write_file')).toBe('edit');
        expect(getPermissionKeyForTool('run_command')).toBe('bash');
        expect(getPermissionKeyForTool('run_shell')).toBe('bash');
        expect(getPermissionKeyForTool('lsp_hover')).toBe('lsp');
        expect(getPermissionKeyForTool('lsp_rename_symbol')).toBe('edit');
        expect(getPermissionKeyForTool('mcp.docs.resources.read', {
            source: 'mcp',
            trust: 'trusted',
            serverName: 'docs',
            operation: 'read_resource',
        })).toBe('read');
        expect(getPermissionKeyForTool('mcp.docs.prompts.get')).toBe('read');
        expect(getPermissionKeyForTool('mcp.deploy.preview', {
            source: 'mcp',
            trust: 'trusted',
            serverName: 'deploy',
            operation: 'tool_call',
        })).toBe('task');
        expect(getPermissionKeyForTool('custom_tool')).toBe('custom_tool');
    });

    it('resolves effective tool permission mode from config', () => {
        expect(resolveToolPermissionMode('write_file', undefined)).toBe('ask');
        expect(resolveToolPermissionMode('write_file', {
            defaultMode: 'deny',
            tools: {},
        })).toBe('deny');
        expect(resolveToolPermissionMode('write_file', {
            defaultMode: 'deny',
            tools: { edit: 'allow' },
        })).toBe('allow');
        expect(resolveToolPermissionMode('lsp_hover', {
            defaultMode: 'deny',
            tools: { lsp: 'ask' },
        })).toBe('ask');
        expect(resolveToolPermissionMode('mcp.docs.resources.read', {
            defaultMode: 'deny',
            tools: { read: 'allow' },
        }, {
            source: 'mcp',
            trust: 'trusted',
            serverName: 'docs',
            operation: 'read_resource',
        })).toBe('allow');
    });

    it('allows normal reads in auto mode', () => {
        expect(resolveToolPermissionDecision({
            toolName: 'read_file',
            permissions: {
                defaultMode: 'auto',
                tools: {},
            },
            hasPriorRead: false,
        })).toBe('allow');
    });

    it('keeps engineering writes gated until the agent has read context first', () => {
        expect(shouldRequireReadBeforeWrite('write_file', false)).toBe(true);
        expect(shouldRequireReadBeforeWrite('write_file', true)).toBe(false);
        expect(requiresCheckpointBeforeTool('write_file')).toBe(true);
        expect(shouldTriggerVerifierAfterTool('write_file')).toBe(true);
        expect(resolveToolPermissionDecision({
            toolName: 'write_file',
            args: { path: 'src/utils.ts' },
            permissions: {
                defaultMode: 'auto',
                tools: {},
            },
            hasPriorRead: true,
        })).toBe('ask');
    });

    it('treats config writes as higher-risk than normal source edits', () => {
        expect(resolveToolPermissionDecision({
            toolName: 'write_file',
            args: { path: 'src/utils.ts' },
            permissions: {
                defaultMode: 'auto',
                tools: {},
            },
            hasPriorRead: true,
        })).toBe('ask');
        expect(resolveToolPermissionDecision({
            toolName: 'write_file',
            args: { path: 'package.json' },
            permissions: {
                defaultMode: 'allow',
                tools: {},
            },
            hasPriorRead: true,
        })).toBe('ask');
    });

    it('forces approval for destructive shell commands even when bash is otherwise allowed', () => {
        expect(resolveToolPermissionDecision({
            toolName: 'run_command',
            args: { command: 'rm -rf ./tmp-cache' },
            permissions: {
                defaultMode: 'allow',
                tools: { bash: 'allow' },
            },
            hasPriorRead: true,
        })).toBe('ask');
    });

    it('forces approval for file paths outside the project even when the tool is otherwise allowed', () => {
        expect(resolveToolPermissionDecision({
            toolName: 'read_file',
            args: { path: '../Desktop/notes.txt' },
            permissions: {
                defaultMode: 'allow',
                tools: {},
            },
            hasPriorRead: true,
            projectRoot: '/workspace/project',
        })).toBe('ask');

        expect(createToolPolicyApprovalPatch({
            toolName: 'read_file',
            args: { path: '../Desktop/notes.txt' },
            permissions: {
                defaultMode: 'allow',
                tools: {},
            },
            hasPriorRead: true,
            projectRoot: '/workspace/project',
        })).toMatchObject({
            force: true,
            summary: 'Request access to path outside project: ../Desktop/notes.txt',
            risk: 'high',
        });
    });

    it('forces approval for sensitive reads even when the tool is explicitly allowed', () => {
        expect(resolveToolPermissionDecision({
            toolName: 'read_file',
            args: { path: '.env.local' },
            permissions: {
                defaultMode: 'allow',
                tools: {},
                allowedTools: ['read_file'],
            },
            hasPriorRead: true,
            projectRoot: '/workspace/project',
        })).toBe('ask');

        expect(createToolPolicyApprovalPatch({
            toolName: 'read_file',
            args: { path: '.env.local' },
            permissions: {
                defaultMode: 'allow',
                tools: {},
            },
            hasPriorRead: true,
            projectRoot: '/workspace/project',
        })).toMatchObject({
            force: true,
            summary: 'Request access to sensitive file: .env.local',
            risk: 'high',
        });
    });

    it('does not let allowed tools bypass hard approval gates for network, dangerous shell, or high-risk writes', () => {
        expect(resolveToolPermissionDecision({
            toolName: 'fetch_url',
            args: { url: 'https://example.com' },
            permissions: {
                defaultMode: 'allow',
                tools: {},
                allowedTools: ['fetch_url'],
            },
            hasPriorRead: true,
        })).toBe('ask');

        expect(resolveToolPermissionDecision({
            toolName: 'run_command',
            args: { command: 'rm -rf ./tmp-cache' },
            permissions: {
                defaultMode: 'allow',
                tools: { bash: 'allow' },
                allowedTools: ['run_command'],
            },
            hasPriorRead: true,
        })).toBe('ask');

        expect(resolveToolPermissionDecision({
            toolName: 'write_file',
            args: { path: 'package.json' },
            permissions: {
                defaultMode: 'allow',
                tools: { edit: 'allow' },
                allowedTools: ['write_file'],
            },
            hasPriorRead: true,
        })).toBe('ask');
    });

    it('treats MCP trust as part of the hard-risk matrix', () => {
        const trustedReadSecurity = {
            source: 'mcp' as const,
            trust: 'trusted' as const,
            serverName: 'docs',
            operation: 'read_resource' as const,
        };
        const untrustedReadSecurity = {
            source: 'mcp' as const,
            trust: 'untrusted' as const,
            serverName: 'remote-docs',
            operation: 'read_resource' as const,
        };
        const trustedToolCallSecurity = {
            source: 'mcp' as const,
            trust: 'trusted' as const,
            serverName: 'deployer',
            operation: 'tool_call' as const,
        };

        expect(resolveToolPermissionDecision({
            toolName: 'mcp.docs.resources.read',
            args: { uri: 'file://README.md' },
            permissions: {
                defaultMode: 'auto',
                tools: {},
            },
            hasPriorRead: true,
            securityContext: trustedReadSecurity,
        })).toBe('allow');

        expect(resolveToolPermissionDecision({
            toolName: 'mcp.remote-docs.resources.read',
            args: { uri: 'file://README.md' },
            permissions: {
                defaultMode: 'allow',
                tools: { read: 'allow' },
                allowedTools: ['read'],
            },
            hasPriorRead: true,
            securityContext: untrustedReadSecurity,
        })).toBe('ask');

        expect(createToolPolicyApprovalPatch({
            toolName: 'mcp.remote-docs.resources.read',
            args: { uri: 'file://README.md' },
            permissions: {
                defaultMode: 'allow',
                tools: { read: 'allow' },
            },
            hasPriorRead: true,
            securityContext: untrustedReadSecurity,
            permissionMode: 'ask',
            hasNativeApprovalRequest: true,
        })).toMatchObject({
            force: true,
            risk: 'high',
        });
        expect(createToolPolicyApprovalPatch({
            toolName: 'mcp.remote-docs.resources.read',
            args: { uri: 'file://README.md' },
            permissions: {
                defaultMode: 'allow',
                tools: { read: 'allow' },
            },
            hasPriorRead: true,
            securityContext: untrustedReadSecurity,
            permissionMode: 'ask',
            hasNativeApprovalRequest: true,
        })?.reason).toContain('untrusted MCP server');

        expect(resolveToolPermissionDecision({
            toolName: 'mcp.deployer.deploy.preview',
            args: { branch: 'main' },
            permissions: {
                defaultMode: 'allow',
                tools: { task: 'allow' },
            },
            hasPriorRead: true,
            securityContext: trustedToolCallSecurity,
        })).toBe('ask');
    });

    it('forces approval when a shell command requests an outside-project cwd', () => {
        expect(resolveToolPermissionDecision({
            toolName: 'run_command',
            args: {
                command: 'ls',
                cwd: '../Desktop',
            },
            permissions: {
                defaultMode: 'allow',
                tools: { bash: 'allow' },
            },
            hasPriorRead: true,
            projectRoot: '/workspace/project',
        })).toBe('ask');
    });

    it('derives V1 approval policies and capability-scoped visibility without re-exposing hidden write tools', () => {
        expect(resolveV1ApprovalPolicy(undefined)).toBe('balanced');
        expect(resolveV1ApprovalPolicy({
            defaultMode: 'deny',
            tools: {},
        })).toBe('strict');
        expect(resolveV1ApprovalPolicy({
            defaultMode: 'allow',
            tools: {},
        })).toBe('workspace_auto');

        expect(isToolVisibleForExecutionCapability('read_file', 'plan')).toBe(true);
        expect(isToolVisibleForExecutionCapability('websearch', 'read_only')).toBe(true);
        expect(isToolVisibleForExecutionCapability('mcp.docs.resources.list', 'plan', {
            source: 'mcp',
            trust: 'trusted',
            serverName: 'docs',
            operation: 'list_resources',
        })).toBe(true);
        expect(isToolVisibleForExecutionCapability('mcp.deployer.deploy.preview', 'plan', {
            source: 'mcp',
            trust: 'trusted',
            serverName: 'deployer',
            operation: 'tool_call',
        })).toBe(false);
        expect(isToolVisibleForExecutionCapability('write_file', 'plan')).toBe(false);
        expect(isToolVisibleForExecutionCapability('run_command', 'read_only')).toBe(false);
        expect(isToolVisibleForExecutionCapability('lsp_rename_symbol', 'plan')).toBe(false);

        expect(createScopedPermissionSettings({
            executionCapability: 'workspace_write',
            approvalPolicy: 'balanced',
        })).toMatchObject({
            defaultMode: 'auto',
            approvalPolicy: 'balanced',
            tools: {
                edit: 'ask',
                bash: 'ask',
                webfetch: 'ask',
            },
        });

        expect(createScopedPermissionSettings({
            executionCapability: 'workspace_write',
            approvalPolicy: 'workspace_auto',
        })).toMatchObject({
            defaultMode: 'auto',
            approvalPolicy: 'workspace_auto',
            tools: {
                edit: 'allow',
                bash: 'ask',
            },
        });

        expect(createScopedPermissionSettings({
            executionCapability: 'plan',
            approvalPolicy: 'workspace_auto',
        })).toMatchObject({
            approvalPolicy: 'workspace_auto',
            tools: {
                edit: 'deny',
                bash: 'deny',
            },
        });
    });

    it('merges approval requests and records without materializing empty optional fields', () => {
        expect(mergeToolApprovalRequest(
            'write_file',
            { path: 'src/a.ts' },
            'tool-call-1',
            undefined,
            { summary: 'not forced' },
        )).toBeUndefined();

        expect(mergeToolApprovalRequest(
            'write_file',
            { path: 'src/a.ts' },
            'tool-call-1',
            {
                toolName: 'write_file',
                summary: 'Base summary',
                reason: 'Base reason',
                preview: 'Base preview',
                risk: 'medium',
            },
            {
                summary: 'Extra summary',
                reason: 'Extra reason',
                preview: 'Extra preview',
                risk: 'high',
            },
        )).toEqual({
            toolName: 'write_file',
            summary: 'Extra summary',
            reason: 'Base reason\n\nExtra reason',
            preview: 'Base preview\n\nExtra preview',
            risk: 'high',
        });

        expect(mergeToolApprovalPatches(
            { summary: 'base', reason: 'same', preview: 'base preview' },
            { force: true, reason: 'same', preview: 'extra preview', risk: 'low' },
        )).toEqual({
            force: true,
            summary: 'base',
            reason: 'same',
            preview: 'base preview\n\nextra preview',
            risk: 'low',
        });

        expect(createToolApprovalPrompt({
            toolName: 'run_command',
            summary: 'Run command',
            risk: 'medium',
        })).toEqual({
            toolCallId: 'unknown-tool-call',
            toolName: 'run_command',
            summary: 'Run command',
            risk: 'medium',
        });

        expect(createApprovalRequestedRecord('approval-1', {
            toolName: 'read_file',
            summary: 'Read config',
            reason: 'Need context',
        })).toEqual({
            requestId: 'approval-1',
            kind: 'tool.use',
            summary: 'Read config',
            payload: 'Need context',
        });
        expect(createApprovalResolvedRecord('approval-1', 'deny')).toEqual({
            requestId: 'approval-1',
            decision: 'deny',
        });
    });

    it('covers remaining policy branches for deny, plan, mcp, and sensitive shell reads', () => {
        expect(resolveToolPermissionDecision({
            toolName: 'write_file',
            permissions: {
                defaultMode: 'allow',
                tools: {},
                disallowedTools: ['write_file'],
            },
            hasPriorRead: true,
        })).toBe('deny');
        expect(resolveToolPermissionDecision({
            toolName: 'write_file',
            permissions: {
                defaultMode: 'allow',
                tools: {},
                disallowedTools: ['edit'],
            },
            hasPriorRead: true,
        })).toBe('deny');
        expect(resolveToolPermissionDecision({
            toolName: 'run_command',
            permissions: {
                defaultMode: 'bypassPermissions',
                tools: { bash: 'bypassPermissions' },
            },
            hasPriorRead: true,
        })).toBe('allow');
        expect(resolveToolPermissionDecision({
            toolName: 'write_file',
            args: { path: 'src/a.ts' },
            permissions: {
                defaultMode: 'plan',
                tools: {},
            },
            hasPriorRead: true,
        })).toBe('ask');
        expect(resolveToolPermissionDecision({
            toolName: 'custom_tool',
            permissions: {
                defaultMode: 'default',
                tools: {},
            },
            hasPriorRead: true,
        })).toBe('ask');

        expect(resolveToolPermissionDecision({
            toolName: 'mcp.docs.prompts.list',
            permissions: {
                defaultMode: 'auto',
                tools: {},
            },
            hasPriorRead: true,
            securityContext: {
                source: 'mcp',
                trust: 'trusted',
                serverName: 'docs',
                operation: 'list_prompts',
            },
        })).toBe('allow');
        expect(resolveToolPermissionDecision({
            toolName: 'mcp.docs.deploy',
            permissions: {
                defaultMode: 'auto',
                tools: {},
            },
            hasPriorRead: true,
            securityContext: {
                source: 'mcp',
                trust: 'trusted',
                serverName: 'docs',
                operation: 'tool_call',
            },
        })).toBe('ask');
        expect(resolveToolPermissionDecision({
            toolName: 'run_command',
            args: { command: 'ls -la' },
            permissions: {
                defaultMode: 'auto',
                tools: {},
            },
            hasPriorRead: true,
        })).toBe('ask');
        expect(resolveToolPermissionDecision({
            toolName: 'custom_tool',
            permissions: {
                defaultMode: 'auto',
                tools: {},
            },
            hasPriorRead: true,
        })).toBe('ask');

        expect(createToolPolicyApprovalPatch({
            toolName: 'run_shell',
            args: { command: 'printenv' },
            permissions: {
                defaultMode: 'allow',
                tools: { bash: 'allow' },
            },
            hasPriorRead: true,
        })).toMatchObject({
            summary: 'Request access to sensitive data via run_shell',
            risk: 'high',
        });
        expect(createToolPolicyApprovalPatch({
            toolName: 'run_command',
            args: { command: 'cat ~/.ssh/id_rsa' },
            permissions: {
                defaultMode: 'allow',
                tools: { bash: 'allow' },
            },
            hasPriorRead: true,
        })?.preview).toContain('cat ~/.ssh/id_rsa');
        expect(createToolPolicyApprovalPatch({
            toolName: 'custom_tool',
            args: { target: 'prod' },
            permissions: {
                defaultMode: 'ask',
                tools: {},
            },
            hasPriorRead: true,
            permissionMode: 'ask',
        })).toMatchObject({
            summary: 'Permission policy requires approval before running custom_tool',
            preview: '{\n  "target": "prod"\n}',
        });
        expect(createToolPolicyApprovalPatch({
            toolName: 'write_file',
            args: { path: 'src/a.ts' },
            permissions: {
                defaultMode: 'ask',
                tools: {},
            },
            hasPriorRead: true,
            permissionMode: 'ask',
        })).toMatchObject({
            summary: 'Permission policy requires approval before running write_file',
            preview: 'projectRoot: (unknown)\ntargetPath: src/a.ts',
        });
        expect(createToolPolicyApprovalPatch({
            toolName: 'mcp.docs.prompts.get',
            permissions: {
                defaultMode: 'allow',
                tools: {},
            },
            hasPriorRead: true,
            securityContext: {
                source: 'mcp',
                trust: 'untrusted',
                serverName: 'docs',
                operation: 'get_prompt',
            },
        })).toMatchObject({
            summary: 'Read MCP prompt @ docs',
            risk: 'high',
        });
        expect(createToolPolicyApprovalPatch({
            toolName: 'mcp.docs.deploy',
            permissions: {
                defaultMode: 'allow',
                tools: {},
            },
            hasPriorRead: true,
            securityContext: {
                source: 'mcp',
                trust: 'trusted',
                serverName: 'docs',
                operation: 'tool_call',
            },
        })).toMatchObject({
            summary: 'Call MCP tool mcp.docs.deploy @ docs',
            risk: 'medium',
        });
    });
});
