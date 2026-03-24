// ============================================================
// 错误分析器
// ============================================================

import { RuntimeErrorType, type RuntimeError } from '@xqoder/shared';

/** 分析结果（含修复建议） */
export interface ErrorAnalysis {
    errors: RuntimeError[];
    /** 自动修复命令（如果有） */
    autoFixCommands: string[];
    /** 给 Agent 的上下文摘要 */
    summaryForAgent: string;
    /** 可选：来自 LSP 的补充诊断摘要 */
    lspDiagnosticsSummary?: string;
}

/**
 * ErrorAnalyzer
 * 解析日志中的错误，分类并生成修复建议
 */
export class ErrorAnalyzer {
    /** 分析日志文本 */
    analyze(logText: string): ErrorAnalysis {
        const errors: RuntimeError[] = [];
        const autoFixCommands: string[] = [];
        const lines = logText.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            const error = this.parseLine(line, i + 1);
            if (error) {
                errors.push(error);

                // 生成自动修复命令
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

    /** 解析单行日志 */
    private parseLine(line: string, lineNum: number): RuntimeError | null {
        // 依赖缺失
        let match = line.match(/Cannot find module ['"]([^'"]+)['"]/);
        if (match) {
            return {
                type: RuntimeErrorType.DependencyMissing,
                message: line.trim(),
                line: lineNum,
                suggestion: `安装缺失的模块: npm install ${match[1]}`,
            };
        }

        match = line.match(/Module not found.*?['"]([^'"]+)['"]/);
        if (match) {
            return {
                type: RuntimeErrorType.DependencyMissing,
                message: line.trim(),
                line: lineNum,
                suggestion: `安装缺失的模块: npm install ${match[1]}`,
            };
        }

        match = line.match(/Could not resolve ['"]([^'"]+)['"]/i);
        if (match) {
            return {
                type: RuntimeErrorType.DependencyMissing,
                message: line.trim(),
                line: lineNum,
                suggestion: `安装缺失的模块: npm install ${match[1]}`,
            };
        }

        match = line.match(/error\s+TS2307:\s*Cannot find module ['"]([^'"]+)['"]/i);
        if (match) {
            return {
                type: RuntimeErrorType.DependencyMissing,
                message: line.trim(),
                line: lineNum,
                suggestion: `安装缺失的模块: npm install ${match[1]}`,
            };
        }

        match = line.match(/ERR_MODULE_NOT_FOUND.*?['"]([^'"]+)['"]/i);
        if (match) {
            return {
                type: RuntimeErrorType.DependencyMissing,
                message: line.trim(),
                line: lineNum,
                suggestion: `安装缺失的模块: npm install ${match[1]}`,
            };
        }

        match = line.match(/sh:\s*([a-zA-Z0-9._-]+):\s*command not found/i);
        if (match) {
            return {
                type: RuntimeErrorType.DependencyMissing,
                message: line.trim(),
                line: lineNum,
                suggestion: `安装缺失的命令依赖: npm install ${match[1]}`,
            };
        }

        match = line.match(/Missing script:\s*["']?([^"']+)["']?/i);
        if (match) {
            return {
                type: RuntimeErrorType.ConfigError,
                message: line.trim(),
                line: lineNum,
                suggestion: `在 package.json 中添加 "${match[1]}" 脚本，或改用已有脚本`,
            };
        }

        match = line.match(/Missing required environment variable:\s*([A-Z0-9_]+)/i);
        if (match) {
            return {
                type: RuntimeErrorType.ConfigError,
                message: line.trim(),
                line: lineNum,
                suggestion: `补充环境变量 ${match[1]}，或在代码中提供默认值`,
            };
        }

        match = line.match(/Environment variable\s+([A-Z0-9_]+)\s+is required/i);
        if (match) {
            return {
                type: RuntimeErrorType.ConfigError,
                message: line.trim(),
                line: lineNum,
                suggestion: `补充环境变量 ${match[1]}，或在代码中提供默认值`,
            };
        }

        // TypeScript 编译错误
        match = line.match(/(.+\.tsx?)\((\d+),(\d+)\):\s*error\s+TS(\d+):\s*(.+)/);
        if (match) {
            return {
                type: RuntimeErrorType.CompileError,
                message: match[5]!.trim(),
                file: match[1],
                line: parseInt(match[2]!, 10),
                suggestion: `修复 TypeScript 错误 TS${match[4]} 在 ${match[1]}:${match[2]}`,
            };
        }

        // 通用编译错误
        if (/Failed to compile|Compilation failed|Build failed/i.test(line)) {
            return {
                type: RuntimeErrorType.CompileError,
                message: line.trim(),
                line: lineNum,
                suggestion: '查看编译错误详情并修复源代码',
            };
        }

        // 端口冲突
        if (/EADDRINUSE|address already in use/i.test(line)) {
            match = line.match(/port\s+(\d+)/i) ?? line.match(/:(\d+)/);
            return {
                type: RuntimeErrorType.PortConflict,
                message: line.trim(),
                line: lineNum,
                suggestion: match ? `端口 ${match[1]} 已被占用，尝试使用其他端口` : '端口冲突，尝试更换端口',
            };
        }

        if (/No tests found|Test failed|AssertionError:/i.test(line)) {
            return {
                type: RuntimeErrorType.RuntimeException,
                message: line.trim(),
                line: lineNum,
                suggestion: '修复失败的测试或更新测试数据',
            };
        }

        // 运行时异常
        if (/TypeError:|ReferenceError:|RangeError:|SyntaxError:/i.test(line)) {
            return {
                type: RuntimeErrorType.RuntimeException,
                message: line.trim(),
                line: lineNum,
                suggestion: '分析运行时错误堆栈并修复代码',
            };
        }

        // 权限错误
        if (/EACCES|Permission denied/i.test(line)) {
            return {
                type: RuntimeErrorType.PermissionDenied,
                message: line.trim(),
                line: lineNum,
                suggestion: '检查文件或目录权限',
            };
        }

        return null;
    }

    /** 获取自动修复命令 */
    private getAutoFix(error: RuntimeError): string | null {
        switch (error.type) {
            case RuntimeErrorType.DependencyMissing: {
                const match = error.message.match(/['"]([^'"]+)['"]/) ?? error.message.match(/sh:\s*([a-zA-Z0-9._-]+):\s*command not found/i);
                if (match) {
                    const pkg = match[1]!.split('/')[0]!;
                    // 过滤相对路径等非包名
                    if (!pkg.startsWith('.') && !pkg.startsWith('/')) {
                        return `npm install ${pkg}`;
                    }
                }
                return null;
            }
            case RuntimeErrorType.PortConflict: {
                // 端口冲突无法自动修复，需要切换端口
                return null;
            }
            default:
                return null;
        }
    }

    /** 构建给 Agent 的摘要 */
    private buildSummary(errors: RuntimeError[]): string {
        if (errors.length === 0) return '没有检测到错误。';

        const grouped = new Map<RuntimeErrorType, RuntimeError[]>();
        for (const err of errors) {
            if (!grouped.has(err.type)) grouped.set(err.type, []);
            grouped.get(err.type)!.push(err);
        }

        const parts: string[] = [`检测到 ${errors.length} 个错误：`];
        for (const [type, errs] of grouped) {
            parts.push(`\n[${type}] (${errs.length} 个):`);
            for (const err of errs.slice(0, 5)) {
                parts.push(`  - ${err.message}`);
                if (err.file) parts.push(`    文件: ${err.file}:${err.line ?? '?'}`);
            }
            if (errs.length > 5) {
                parts.push(`  ... 还有 ${errs.length - 5} 个同类错误`);
            }
        }

        return parts.join('\n');
    }
}
