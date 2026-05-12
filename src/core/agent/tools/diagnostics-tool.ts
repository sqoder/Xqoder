// ============================================================
// Diagnostics Tool — LSP Diagnostics Aggregator
// Reference: internal/llm/tools/diagnostics.go
// ============================================================

import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolContext } from './tool.js';

/**
 * LSP Diagnostic Severity Level
 */
enum DiagnosticSeverity {
    Error = 1,
    Warning = 2,
    Information = 3,
    Hint = 4,
}

/**
 * LSP Diagnostic Entry
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
 * Retrieves LSP diagnostic information (errors, warnings, hints) for a file or the project
 */
export class DiagnosticsTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'diagnostics',
        description: [
            'Retrieve code diagnostic information (errors, warnings, hints) for a file or the project.',
            'Uses LSP (Language Server Protocol) to get real-time compilation errors and code issues.',
            'Usage:',
            '  - Check if new errors were introduced after code modifications',
            '  - Get type checking results',
            '  - Confirm an issue is resolved after fixing a bug',
            'Tip: Returns diagnostics for the entire project if no file path is specified.',
        ].join('\n'),
        parameters: [
            {
                name: 'file_path',
                type: 'string',
                description: 'The file path (relative or absolute) to get diagnostics for. Leave empty for project-wide diagnostics.',
                required: false,
            },
        ],
    };

    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return true;
    }

    async execute(
        args: Record<string, unknown>,
        context: ToolContext,
    ): Promise<ToolResult> {
        const toolCallId = String(args['toolCallId'] ?? '');
        const filePath = args['file_path'] ? String(args['file_path']) : undefined;

        // Try to get diagnostics from LSP client via context.
        // Since we might not have a direct LSP client reference,
        // we provide a fallback using command-line tools.
        try {
            const diagnosticsOutput = await this.collectDiagnostics(filePath, context);

            if (!diagnosticsOutput) {
                return {
                    toolCallId,
                    success: true,
                    output: filePath
                        ? `✅ No diagnostic issues found in file ${filePath}.`
                        : '✅ No diagnostic issues found in the project.',
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
                error: `Failed to retrieve diagnostics: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    private async collectDiagnostics(
        filePath: string | undefined,
        context: ToolContext,
    ): Promise<string> {
        // Get diagnosticsProvider from context (if available)
        const diagnosticsProvider = (context as unknown as Record<string, unknown>)['diagnosticsProvider'] as
            | DiagnosticsProvider
            | undefined;

        if (diagnosticsProvider) {
            return this.formatLspDiagnostics(
                await diagnosticsProvider.getDiagnostics(filePath),
                filePath,
            );
        }

        // Fallback: Check using TypeScript compiler
        return this.runTscCheck(filePath, context);
    }

    private async runTscCheck(
        filePath: string | undefined,
        context: ToolContext,
    ): Promise<string> {
        const { spawnSync } = await import('node:child_process');
        const path = await import('node:path');

        const cwd = context.projectRoot || context.cwd;

        // Try running tsc --noEmit
        const tscArgs = ['--noEmit', '--pretty', 'false'];
        if (filePath) {
            const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
            tscArgs.push(absPath);
        }

        // Try npx tsc first, then global tsc
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

        // Parse tsc output
        return this.parseTscOutput(output, filePath);
    }

    private parseTscOutput(output: string, filePath?: string): string {
        const lines = output.split('\n').filter(Boolean);
        const errors: string[] = [];
        const warnings: string[] = [];

        for (const line of lines) {
            // tsc format: file(line,col): error TS1234: message
            const match = line.match(/^(.+)\((\d+),(\d+)\):\s*(error|warning)\s+TS(\d+):\s*(.+)$/);
            if (match) {
                const [, file, lineNum, col, severity, code, message] = match;

                // If specific file is provided, only show diagnostics for that file
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
            // Original output might not be in standard tsc format, return as-is
            return output.length > 5000 ? output.slice(0, 5000) + '\n...(truncated)' : output;
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

        // Sort: Errors first
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

// ---- Extension Interfaces ----

/**
 * DiagnosticsProvider interface
 * Can be implemented by LSP client and injected into ToolContext
 */
export interface DiagnosticsProvider {
    getDiagnostics(filePath?: string): Promise<Map<string, Diagnostic[]>>;
}
