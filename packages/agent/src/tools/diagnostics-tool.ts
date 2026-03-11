// ============================================================
// Diagnostics 工具 — LSP 诊断聚合
// 参考 OpenCode: internal/llm/tools/diagnostics.go
// ============================================================

import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolContext } from './tool.js';

/**
 * LSP 诊断严重级别
 */
enum DiagnosticSeverity {
    Error = 1,
    Warning = 2,
    Information = 3,
    Hint = 4,
}

/**
 * LSP 诊断条目
 */
interface Diagnostic {
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    severity?: DiagnosticSeverity;
    code?: string | number;
    source?: string;
    message: string;
    tags?: number[];
}

/**
 * DiagnosticsTool
 * 获取文件或项目的 LSP 诊断信息（错误、警告、提示）
 */
export class DiagnosticsTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'diagnostics',
        description: [
            '获取文件或项目的代码诊断信息（错误、警告、提示）。',
            '使用 LSP（Language Server Protocol）获取实时的编译错误和代码问题。',
            '用途：',
            '  - 检查代码修改后是否引入了新的错误',
            '  - 获取类型检查结果',
            '  - 在修复 bug 后确认问题已解决',
            '提示：不指定文件路径时返回整个项目的诊断信息。',
        ].join('\n'),
        parameters: [
            {
                name: 'file_path',
                type: 'string',
                description: '要获取诊断的文件路径（相对路径或绝对路径）。留空则获取整个项目诊断。',
                required: false,
            },
        ],
    };

    async execute(
        args: Record<string, unknown>,
        context: ToolContext,
    ): Promise<ToolResult> {
        const toolCallId = String(args['toolCallId'] ?? '');
        const filePath = args['file_path'] ? String(args['file_path']) : undefined;

        // 尝试通过 context 获取 LSP 客户端的诊断
        // 由于我们可能没有直接的 LSP 客户端引用，
        // 这里提供一个通过命令行工具获取诊断的回退方案
        try {
            const diagnosticsOutput = await this.collectDiagnostics(filePath, context);

            if (!diagnosticsOutput) {
                return {
                    toolCallId,
                    success: true,
                    output: filePath
                        ? `✅ 文件 ${filePath} 没有发现诊断问题。`
                        : '✅ 项目中没有发现诊断问题。',
                };
            }

            return {
                toolCallId,
                success: true,
                output: diagnosticsOutput,
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `获取诊断失败: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    private async collectDiagnostics(
        filePath: string | undefined,
        context: ToolContext,
    ): Promise<string> {
        // 从上下文获取 diagnosticsProvider（如果存在）
        const diagnosticsProvider = (context as unknown as Record<string, unknown>)['diagnosticsProvider'] as
            | DiagnosticsProvider
            | undefined;

        if (diagnosticsProvider) {
            return this.formatLspDiagnostics(
                await diagnosticsProvider.getDiagnostics(filePath),
                filePath,
            );
        }

        // 回退方案：通过 TypeScript 编译器检查
        return this.runTscCheck(filePath, context);
    }

    private async runTscCheck(
        filePath: string | undefined,
        context: ToolContext,
    ): Promise<string> {
        const { spawnSync } = await import('node:child_process');
        const path = await import('node:path');

        const cwd = context.projectRoot || context.cwd;

        // 尝试运行 tsc --noEmit
        const tscArgs = ['--noEmit', '--pretty', 'false'];
        if (filePath) {
            const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
            tscArgs.push(absPath);
        }

        // 先尝试 npx tsc，再尝试全局 tsc
        const result = spawnSync('npx', ['tsc', ...tscArgs], {
            cwd,
            timeout: 30_000,
            encoding: 'utf-8',
            env: { ...process.env, ...context.env },
        });

        const output = (result.stdout || '') + (result.stderr || '');

        if (!output.trim()) {
            return '';
        }

        // 解析 tsc 输出
        return this.parseTscOutput(output, filePath);
    }

    private parseTscOutput(output: string, filePath?: string): string {
        const lines = output.split('\n').filter(Boolean);
        const errors: string[] = [];
        const warnings: string[] = [];

        for (const line of lines) {
            // tsc 格式: file(line,col): error TS1234: message
            const match = line.match(/^(.+)\((\d+),(\d+)\):\s*(error|warning)\s+TS(\d+):\s*(.+)$/);
            if (match) {
                const [, file, lineNum, col, severity, code, message] = match;

                // 如果指定了文件，只显示该文件的诊断
                if (filePath && !file.includes(filePath)) {
                    continue;
                }

                const formatted = `${severity === 'error' ? 'Error' : 'Warn'}: ${file}:${lineNum}:${col} [typescript][TS${code}] ${message}`;

                if (severity === 'error') {
                    errors.push(formatted);
                } else {
                    warnings.push(formatted);
                }
            }
        }

        if (errors.length === 0 && warnings.length === 0) {
            // 原始输出可能不是标准 tsc 格式，直接返回
            return output.length > 5000 ? output.slice(0, 5000) + '\n...(已截断)' : output;
        }

        const sections: string[] = [];

        if (filePath) {
            if (errors.length > 0 || warnings.length > 0) {
                sections.push('<file_diagnostics>');
                const allDiags = [...errors, ...warnings];
                if (allDiags.length > 10) {
                    sections.push(...allDiags.slice(0, 10));
                    sections.push(`... and ${allDiags.length - 10} more diagnostics`);
                } else {
                    sections.push(...allDiags);
                }
                sections.push('</file_diagnostics>');
            }
        } else {
            if (errors.length > 0 || warnings.length > 0) {
                sections.push('<project_diagnostics>');
                const allDiags = [...errors, ...warnings];
                if (allDiags.length > 20) {
                    sections.push(...allDiags.slice(0, 20));
                    sections.push(`... and ${allDiags.length - 20} more diagnostics`);
                } else {
                    sections.push(...allDiags);
                }
                sections.push('</project_diagnostics>');
            }
        }

        sections.push('');
        sections.push('<diagnostic_summary>');
        sections.push(`Errors: ${errors.length}, Warnings: ${warnings.length}`);
        sections.push('</diagnostic_summary>');

        return sections.join('\n');
    }

    private formatLspDiagnostics(
        diagnostics: Map<string, Diagnostic[]>,
        filePath?: string,
    ): string {
        const fileDiags: string[] = [];
        const projectDiags: string[] = [];

        for (const [uri, diags] of diagnostics.entries()) {
            const isCurrentFile = filePath ? uri.includes(filePath) : false;

            for (const diag of diags) {
                const severity = this.severityLabel(diag.severity);
                const location = `${uri}:${diag.range.start.line + 1}:${diag.range.start.character + 1}`;
                const source = diag.source ?? '';
                const code = diag.code ? `[${diag.code}]` : '';

                const formatted = `${severity}: ${location} [${source}]${code} ${diag.message}`;

                if (isCurrentFile) {
                    fileDiags.push(formatted);
                } else {
                    projectDiags.push(formatted);
                }
            }
        }

        // 排序：Error 优先
        const sortDiags = (a: string, b: string) => {
            const aIsError = a.startsWith('Error');
            const bIsError = b.startsWith('Error');
            if (aIsError !== bIsError) return aIsError ? -1 : 1;
            return a.localeCompare(b);
        };

        fileDiags.sort(sortDiags);
        projectDiags.sort(sortDiags);

        const sections: string[] = [];

        if (fileDiags.length > 0) {
            sections.push('<file_diagnostics>');
            sections.push(...(fileDiags.length > 10 ? [...fileDiags.slice(0, 10), `... and ${fileDiags.length - 10} more`] : fileDiags));
            sections.push('</file_diagnostics>');
        }

        if (projectDiags.length > 0) {
            sections.push('<project_diagnostics>');
            sections.push(...(projectDiags.length > 10 ? [...projectDiags.slice(0, 10), `... and ${projectDiags.length - 10} more`] : projectDiags));
            sections.push('</project_diagnostics>');
        }

        if (fileDiags.length > 0 || projectDiags.length > 0) {
            const fileErrors = fileDiags.filter(d => d.startsWith('Error')).length;
            const fileWarnings = fileDiags.filter(d => d.startsWith('Warn')).length;
            const projErrors = projectDiags.filter(d => d.startsWith('Error')).length;
            const projWarnings = projectDiags.filter(d => d.startsWith('Warn')).length;

            sections.push('');
            sections.push('<diagnostic_summary>');
            if (filePath) {
                sections.push(`Current file: ${fileErrors} errors, ${fileWarnings} warnings`);
            }
            sections.push(`Project: ${projErrors} errors, ${projWarnings} warnings`);
            sections.push('</diagnostic_summary>');
        }

        return sections.join('\n');
    }

    private severityLabel(severity?: DiagnosticSeverity): string {
        switch (severity) {
            case DiagnosticSeverity.Error:
                return 'Error';
            case DiagnosticSeverity.Warning:
                return 'Warn';
            case DiagnosticSeverity.Hint:
                return 'Hint';
            default:
                return 'Info';
        }
    }
}

// ---- 扩展接口 ----

/**
 * DiagnosticsProvider 接口
 * 可由 LSP 客户端实现，注入到 ToolContext 中
 */
export interface DiagnosticsProvider {
    getDiagnostics(filePath?: string): Promise<Map<string, Diagnostic[]>>;
}
