import type {
    AgentPermissionMode,
    PermissionSettings,
} from '@xqoder/foundation-shared/types/permissions.js';

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

export const LSP_TOOL_PERMISSION_KEY = 'lsp';
const VALID_PERMISSION_MODES: AgentPermissionMode[] = ['allow', 'ask', 'deny'];

export function getPermissionKeyForTool(toolName: string): string {
    if (toolName.startsWith('lsp_')) {
        return LSP_TOOL_PERMISSION_KEY;
    }

    return TOOL_TO_PERMISSION_KEY[toolName] ?? toolName;
}

export function resolveToolPermissionMode(
    toolName: string,
    permissions: PermissionSettings | undefined,
): AgentPermissionMode {
    if (!permissions) {
        return 'ask';
    }

    const key = getPermissionKeyForTool(toolName);
    const mode = permissions.tools?.[key] ?? permissions.defaultMode ?? 'ask';
    return VALID_PERMISSION_MODES.includes(mode) ? mode : 'ask';
}
