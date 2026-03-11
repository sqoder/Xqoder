// ============================================================
// 权限系统 — 工具执行前的权限控制
// 参考 OpenCode: internal/permission/
// ============================================================

import type { SandboxMode } from '@xqoder/shared';

/**
 * 权限策略
 */
export type PermissionPolicy =
    | 'ask'         // 每次都询问用户
    | 'allow-once'  // 本次允许，下次重新询问
    | 'allow-session' // 本 session 内自动允许
    | 'deny';       // 拒绝

/**
 * 权限请求
 */
export interface PermissionRequest {
    sessionId: string;
    toolName: string;
    action: string;
    description: string;
    path?: string;
    risk: 'low' | 'medium' | 'high';
}

/**
 * 权限决策结果
 */
export interface PermissionDecision {
    allowed: boolean;
    policy: PermissionPolicy;
    reason?: string;
}

/**
 * 工具风险等级默认映射
 */
const DEFAULT_TOOL_RISKS: Record<string, 'low' | 'medium' | 'high'> = {
    // 只读工具 — 低风险
    'read_file': 'low',
    'list_files': 'low',
    'glob_files': 'low',
    'grep_content': 'low',
    'search_code': 'low',
    'preview_diff': 'low',
    'diagnostics': 'low',
    'lsp_hover': 'low',
    'lsp_definition': 'low',
    'lsp_references': 'low',
    'lsp_completion': 'low',
    'lsp_workspace_symbols': 'low',
    'lsp_file_diagnostics': 'low',

    // 写入工具 — 中风险
    'write_file': 'medium',
    'apply_patch': 'medium',
    'lsp_rename': 'medium',
    'fetch_url': 'medium',

    // 命令执行 — 高风险
    'run_command': 'high',
    'install_package': 'high',
    'restore_rollback_point': 'medium',
};

/**
 * PermissionManager
 * 管理工具执行权限
 */
export class PermissionManager {
    /** 已授权的 (sessionId + toolName) 组合 */
    private sessionGrants = new Set<string>();
    /** 路径级 session 授权: key = sessionId:toolName:path */
    private pathGrants = new Set<string>();

    /** Sandbox 模式 */
    private sandboxMode: SandboxMode;

    /** 权限询问回调 */
    private askUser?: (request: PermissionRequest) => Promise<PermissionDecision>;

    constructor(options: {
        sandboxMode?: SandboxMode;
        askUser?: (request: PermissionRequest) => Promise<PermissionDecision>;
    }) {
        this.sandboxMode = options.sandboxMode ?? 'project';
        this.askUser = options.askUser;
    }

    /**
     * 检查权限
     */
    async check(request: PermissionRequest): Promise<PermissionDecision> {
        const risk = request.risk ?? DEFAULT_TOOL_RISKS[request.toolName] ?? 'medium';

        // 低风险工具自动放行
        if (risk === 'low') {
            return { allowed: true, policy: 'allow-once' };
        }

        // 已授权的 session-level grant (tool-wide or path-specific)
        const grantKey = `${request.sessionId}:${request.toolName}`;
        if (this.sessionGrants.has(grantKey)) {
            return { allowed: true, policy: 'allow-session' };
        }
        if (request.path) {
            const pathKey = `${request.sessionId}:${request.toolName}:${request.path}`;
            if (this.pathGrants.has(pathKey)) {
                return { allowed: true, policy: 'allow-session' };
            }
        }

        // full-access 模式下自动放行
        if (this.sandboxMode === 'full-access') {
            return { allowed: true, policy: 'allow-session' };
        }

        // 需要用户确认
        if (this.askUser) {
            const decision = await this.askUser({ ...request, risk });

            if (decision.allowed && decision.policy === 'allow-session') {
                this.sessionGrants.add(grantKey);
            }

            return decision;
        }

        // 无用户确认回调，中风险允许，高风险拒绝
        if (risk === 'medium') {
            return { allowed: true, policy: 'allow-once' };
        }

        return {
            allowed: false,
            policy: 'deny',
            reason: `高风险操作 "${request.toolName}" 需要用户确认`,
        };
    }

    /**
     * 获取工具的默认风险等级
     */
    getToolRisk(toolName: string): 'low' | 'medium' | 'high' {
        return DEFAULT_TOOL_RISKS[toolName] ?? 'medium';
    }

    /**
     * 手动授权（tool-wide 或 path-specific）
     */
    grant(sessionId: string, toolName: string, filePath?: string): void {
        if (filePath) {
            this.pathGrants.add(`${sessionId}:${toolName}:${filePath}`);
        } else {
            this.sessionGrants.add(`${sessionId}:${toolName}`);
        }
    }

    /**
     * 撤销授权
     */
    revoke(sessionId: string, toolName: string, filePath?: string): void {
        if (filePath) {
            this.pathGrants.delete(`${sessionId}:${toolName}:${filePath}`);
        } else {
            this.sessionGrants.delete(`${sessionId}:${toolName}`);
        }
    }

    /**
     * 清除 session 的所有授权
     */
    clearSession(sessionId: string): void {
        const prefix = `${sessionId}:`;
        for (const key of Array.from(this.sessionGrants)) {
            if (key.startsWith(prefix)) this.sessionGrants.delete(key);
        }
        for (const key of Array.from(this.pathGrants)) {
            if (key.startsWith(prefix)) this.pathGrants.delete(key);
        }
    }

    /** 列出某 session 的所有已授权项 */
    listGrants(sessionId: string): Array<{ toolName: string; path?: string }> {
        const result: Array<{ toolName: string; path?: string }> = [];
        const prefix = `${sessionId}:`;
        for (const key of this.sessionGrants) {
            if (key.startsWith(prefix)) {
                result.push({ toolName: key.slice(prefix.length) });
            }
        }
        for (const key of this.pathGrants) {
            if (key.startsWith(prefix)) {
                const rest = key.slice(prefix.length);
                const colonIdx = rest.indexOf(':');
                if (colonIdx >= 0) {
                    result.push({ toolName: rest.slice(0, colonIdx), path: rest.slice(colonIdx + 1) });
                }
            }
        }
        return result;
    }
}
