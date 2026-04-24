import * as path from 'node:path';
import type { SandboxMode } from '@xqoder/shared';
import { isForbiddenCommand } from '../../../domain/permissions/sensitive-paths.js';

export class SandboxAccessError extends Error {
    readonly kind = 'sandbox_access_error';
    readonly inputPath: string;
    readonly resolvedPath: string;
    readonly sandboxMode: SandboxMode;

    constructor(inputPath: string, resolvedPath: string, sandboxMode: SandboxMode) {
        super(`Path exceeds current sandbox: ${inputPath}`);
        this.name = 'SandboxAccessError';
        this.inputPath = inputPath;
        this.resolvedPath = resolvedPath;
        this.sandboxMode = sandboxMode;
    }
}

export function isSandboxAccessError(error: unknown): error is SandboxAccessError {
    return error instanceof SandboxAccessError
        || (
            typeof error === 'object'
            && error !== null
            && 'kind' in error
            && (error as { kind?: string }).kind === 'sandbox_access_error'
        );
}

export function resolvePathWithinProject(
    inputPath: string,
    context: {
        cwd: string;
        projectRoot: string;
        sandboxMode?: SandboxMode;
        allowedPaths?: string[];
    },
): string {
    const sandboxMode = context.sandboxMode ?? 'project';
    const resolvedPath = path.isAbsolute(inputPath)
        ? path.normalize(inputPath)
        : path.resolve(context.cwd, inputPath);

    if (sandboxMode === 'full-access') {
        return resolvedPath;
    }

    const allowedRoots = getAllowedRoots(context);
    if (!allowedRoots.some((root) => isPathInsideRoot(resolvedPath, root))) {
        throw new SandboxAccessError(inputPath, resolvedPath, sandboxMode);
    }

    return resolvedPath;
}

export function resolveWorkingDirectory(
    cwd: string | undefined,
    context: {
        cwd: string;
        projectRoot: string;
        sandboxMode?: SandboxMode;
        allowedPaths?: string[];
    },
): string {
    return resolvePathWithinProject(cwd ?? context.cwd, context);
}

export function validateCommandSafety(command: string): string | undefined {
    if (isForbiddenCommand(command)) {
        return `Command rejected by sandbox: ${command}`;
    }

    const dangerousPatterns = [
        /\bsudo\b/,
        /\brm\s+-rf\s+\/\b/,
        /\bmkfs\b/,
        /\bshutdown\b/,
        /\breboot\b/,
        /curl\b[^|]*\|\s*(sh|bash)\b/,
        /wget\b[^|]*\|\s*(sh|bash)\b/,
    ];

    for (const pattern of dangerousPatterns) {
        if (pattern.test(command)) {
            return `Command rejected by sandbox: ${command}`;
        }
    }

    return undefined;
}

function getAllowedRoots(context: {
    projectRoot: string;
    allowedPaths?: string[];
}): string[] {
    const roots = [
        path.resolve(context.projectRoot),
        ...(context.allowedPaths ?? []).map((entry) => path.resolve(entry)),
    ];

    return Array.from(new Set(roots));
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
    const relativePath = path.relative(rootPath, targetPath);
    return relativePath === ''
        || (
            !relativePath.startsWith('..')
            && !path.isAbsolute(relativePath)
        );
}
