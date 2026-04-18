// ============================================================
// Error Analyzer
// ============================================================

import { RuntimeErrorType, type RuntimeError } from '@xqoder/shared';

/** Analysis result (including repair suggestions) */
export interface ErrorAnalysis {
    errors: RuntimeError[];
    /** Auto-fix command (if any) */
    autoFixCommands: string[];
    /** Summary for the Agent context */
    summaryForAgent: string;
}

/**
 * ErrorAnalyzer
 * Parses log errors, categorizes them, and generates repair suggestions
 */
export class ErrorAnalyzer {
    /** Analyze log text */
    analyze(logText: string): ErrorAnalysis {
        const errors: RuntimeError[] = [];
        const autoFixCommands: string[] = [];
        const lines = logText.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            const error = this.parseLine(line, i + 1);
            if (error) {
                errors.push(error);

                // Generate auto-fix command
                const fix = this.getAutoFix(error);
                if (fix && !autoFixCommands.includes(fix)) {
                    autoFixCommands.push(fix);
                }
            }
        }

        return {
            errors,
            autoFixCommands,
            summaryForAgent: this.buildSummary(errors),
        };
    }

    /** Parse a single log line */
    private parseLine(line: string, lineNum: number): RuntimeError | null {
        // Missing dependency
        let match = line.match(/Cannot find module ['"]([^'"]+)['"]/);
        if (match) {
            return {
                type: RuntimeErrorType.DependencyMissing,
                message: line.trim(),
                line: lineNum,
                suggestion: `Install missing module: npm install ${match[1]}`,
            };
        }

        match = line.match(/Module not found.*?['"]([^'"]+)['"]/);
        if (match) {
            return {
                type: RuntimeErrorType.DependencyMissing,
                message: line.trim(),
                line: lineNum,
                suggestion: `Install missing module: npm install ${match[1]}`,
            };
        }

        match = line.match(/Could not resolve ['"]([^'"]+)['"]/i);
        if (match) {
            return {
                type: RuntimeErrorType.DependencyMissing,
                message: line.trim(),
                line: lineNum,
                suggestion: `Install missing module: npm install ${match[1]}`,
            };
        }

        match = line.match(/error\s+TS2307:\s*Cannot find module ['"]([^'"]+)['"]/i);
        if (match) {
            return {
                type: RuntimeErrorType.DependencyMissing,
                message: line.trim(),
                line: lineNum,
                suggestion: `Install missing module: npm install ${match[1]}`,
            };
        }

        match = line.match(/ERR_MODULE_NOT_FOUND.*?['"]([^'"]+)['"]/i);
        if (match) {
            return {
                type: RuntimeErrorType.DependencyMissing,
                message: line.trim(),
                line: lineNum,
                suggestion: `Install missing module: npm install ${match[1]}`,
            };
        }

        match = line.match(/sh:\s*([a-zA-Z0-9._-]+):\s*command not found/i);
        if (match) {
            return {
                type: RuntimeErrorType.DependencyMissing,
                message: line.trim(),
                line: lineNum,
                suggestion: `Install missing command dependency: npm install ${match[1]}`,
            };
        }

        match = line.match(/Missing script:\s*["']?([^"']+)["']?/i);
        if (match) {
            return {
                type: RuntimeErrorType.ConfigError,
                message: line.trim(),
                line: lineNum,
                suggestion: `Add "${match[1]}" script to package.json, or use an existing script`,
            };
        }

        match = line.match(/Missing required environment variable:\s*([A-Z0-9_]+)/i);
        if (match) {
            return {
                type: RuntimeErrorType.ConfigError,
                message: line.trim(),
                line: lineNum,
                suggestion: `Provide environment variable ${match[1]}, or provide a default value in code`,
            };
        }

        match = line.match(/Environment variable\s+([A-Z0-9_]+)\s+is required/i);
        if (match) {
            return {
                type: RuntimeErrorType.ConfigError,
                message: line.trim(),
                line: lineNum,
                suggestion: `Provide environment variable ${match[1]}, or provide a default value in code`,
            };
        }

        // TypeScript compilation error
        match = line.match(/(.+\.tsx?)\((\d+),(\d+)\):\s*error\s+TS(\d+):\s*(.+)/);
        if (match) {
            return {
                type: RuntimeErrorType.CompileError,
                message: match[5]!.trim(),
                file: match[1],
                line: parseInt(match[2]!, 10),
                suggestion: `Fix TypeScript error TS${match[4]} at ${match[1]}:${match[2]}`,
            };
        }

        // General compilation error
        if (/Failed to compile|Compilation failed|Build failed/i.test(line)) {
            return {
                type: RuntimeErrorType.CompileError,
                message: line.trim(),
                line: lineNum,
                suggestion: 'Check compilation error details and fix source code',
            };
        }

        // Port conflict
        if (/EADDRINUSE|address already in use/i.test(line)) {
            match = line.match(/port\s+(\d+)/i) ?? line.match(/:(\d+)/);
            return {
                type: RuntimeErrorType.PortConflict,
                message: line.trim(),
                line: lineNum,
                suggestion: match ? `Port ${match[1]} is already in use, try using a different port` : 'Port conflict, try a different port',
            };
        }

        if (/No tests found|Test failed|AssertionError:/i.test(line)) {
            return {
                type: RuntimeErrorType.RuntimeException,
                message: line.trim(),
                line: lineNum,
                suggestion: 'Fix failing tests or update test data',
            };
        }

        // Runtime exception
        if (/TypeError:|ReferenceError:|RangeError:|SyntaxError:/i.test(line)) {
            return {
                type: RuntimeErrorType.RuntimeException,
                message: line.trim(),
                line: lineNum,
                suggestion: 'Analyze runtime error stack and fix code',
            };
        }

        // Permission error
        if (/EACCES|Permission denied/i.test(line)) {
            return {
                type: RuntimeErrorType.PermissionDenied,
                message: line.trim(),
                line: lineNum,
                suggestion: 'Check file or directory permissions',
            };
        }

        return null;
    }

    /** Get auto-fix command */
    private getAutoFix(error: RuntimeError): string | null {
        switch (error.type) {
            case RuntimeErrorType.DependencyMissing: {
                const match = error.message.match(/['"]([^'"]+)['"]/) ?? error.message.match(/sh:\s*([a-zA-Z0-9._-]+):\s*command not found/i);
                if (match) {
                    const pkg = match[1]!.split('/')[0]!;
                    // Filter relative paths and other non-package names
                    if (!pkg.startsWith('.') && !pkg.startsWith('/')) {
                        return `npm install ${pkg}`;
                    }
                }
                return null;
            }
            case RuntimeErrorType.PortConflict: {
                // Port conflicts cannot be auto-fixed, requires port switching
                return null;
            }
            default:
                return null;
        }
    }

    /** Build summary for the Agent */
    private buildSummary(errors: RuntimeError[]): string {
        if (errors.length === 0) return 'No errors detected.';

        const grouped = new Map<RuntimeErrorType, RuntimeError[]>();
        for (const err of errors) {
            if (!grouped.has(err.type)) grouped.set(err.type, []);
            grouped.get(err.type)!.push(err);
        }

        const parts: string[] = [`Detected ${errors.length} error(s):`];
        for (const [type, errs] of grouped) {
            parts.push(`\n[${type}] (${errs.length} total):`);
            for (const err of errs.slice(0, 5)) {
                parts.push(`  - ${err.message}`);
                if (err.file) parts.push(`    file: ${err.file}:${err.line ?? '?'}`);
            }
            if (errs.length > 5) {
                parts.push(`  ... and ${errs.length - 5} more similar errors`);
            }
        }

        return parts.join('\n');
    }
}
