import type { AgentPermissionMode, PermissionSettings } from './config-types.js';

export const TOOL_TO_PERMISSION_KEY: Record<string, string> = {
    read_file: 'read',
    write_file: 'edit',
    preview_diff: 'edit',
    apply_patch: 'edit',
    restore_rollback_point: 'edit',
    run_command: 'bash',
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
    todowrite: 'todowrite',
    todoread: 'todoread',
    question: 'question',
};

export function getPermissionKeyForTool(toolName: string): string {
    if (toolName.startsWith('lsp_')) {
        return 'lsp';
    }

    return TOOL_TO_PERMISSION_KEY[toolName] ?? toolName;
}

export function normalizePermissionMode(mode: string | undefined): AgentPermissionMode {
    return mode === 'allow' || mode === 'ask' || mode === 'deny' ? mode : 'ask';
}

export function resolveToolPermissionMode(
    toolName: string,
    permissions: PermissionSettings | undefined,
): AgentPermissionMode {
    if (!permissions) {
        return 'ask';
    }

    return normalizePermissionMode(
        permissions.tools?.[getPermissionKeyForTool(toolName)] ?? permissions.defaultMode,
    );
}
