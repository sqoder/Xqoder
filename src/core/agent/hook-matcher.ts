import type { HookMatcherConfig } from '@xqoder/shared';

const TOOL_MATCHER_ALIASES: Record<string, string[]> = {
    run_command: ['run_command', 'bash', 'shell'],
    install_package: ['install_package', 'bash', 'shell'],
    read_file: ['read_file', 'read'],
    read_any_file: ['read_any_file', 'read_file', 'read'],
    write_file: ['write_file', 'write', 'edit'],
    edit_file: ['edit_file', 'edit', 'write'],
    apply_patch: ['apply_patch', 'edit', 'patch'],
    preview_diff: ['preview_diff', 'edit', 'diff'],
    restore_rollback_point: ['restore_rollback_point', 'edit', 'rollback'],
    fetch_url: ['fetch_url', 'webfetch'],
    websearch: ['websearch', 'websearchtool'],
    search_code: ['search_code', 'grep'],
    grep_content: ['grep_content', 'grep'],
    glob_files: ['glob_files', 'glob'],
    list_files: ['list_files', 'list', 'ls'],
    delegate_task: ['delegate_task', 'task', 'agent'],
};

export function matchesToolHook(matcherGroup: HookMatcherConfig, toolName: string): boolean {
    const matcher = matcherGroup.matcher?.trim();
    if (!matcher || matcher === '*') {
        return true;
    }

    // Lifecycle hook payloads without a matcher target (session/stop/pre-compact)
    // only match an explicit `*`; a named matcher is treated as tool-specific
    // and therefore cannot match an empty target.
    if (!toolName) {
        return false;
    }

    const normalizedMatcher = matcher.toLowerCase();
    const aliases = new Set([
        toolName.toLowerCase(),
        ...(TOOL_MATCHER_ALIASES[toolName] ?? []).map((entry) => entry.toLowerCase()),
    ]);
    if (aliases.has(normalizedMatcher)) {
        return true;
    }

    if (!normalizedMatcher.includes('*')) {
        return false;
    }

    const pattern = new RegExp(`^${escapeRegExp(normalizedMatcher).replace(/\\\*/g, '.*')}$`, 'i');
    return Array.from(aliases).some((alias) => pattern.test(alias));
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
