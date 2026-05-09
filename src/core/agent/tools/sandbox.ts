import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SandboxMode } from '@xqoder/shared';
import {
    classifyReadPathScope,
    isPathInAllowedReadRoots,
    isPathInWorkspaceRoots,
    isInternalRuntimeReadPath,
    resolvePermissionCheckPaths,
} from '../../../domain/permissions/filesystem-scope.js';
import {
    describeSuspiciousPath,
    hasGlobPathPattern,
    isForbiddenCommand,
} from '../../../domain/permissions/sensitive-paths.js';

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
    const suspiciousPathReason = describeSuspiciousPath(inputPath);
    if (suspiciousPathReason) {
        throw new Error(`Suspicious path is not allowed for sandboxed write access: ${inputPath} (${suspiciousPathReason})`);
    }

    const sandboxMode = context.sandboxMode ?? 'project';
    const resolvedPath = path.isAbsolute(inputPath)
        ? path.normalize(inputPath)
        : path.resolve(context.cwd, inputPath);

    if (hasGlobPathPattern(inputPath)) {
        throw new Error(`Glob write targets are not allowed: ${inputPath}`);
    }

    if (sandboxMode === 'full-access') {
        return resolvedPath;
    }

    const allowedRoots = getAllowedRoots(context);
    const candidatePaths = new Set<string>([resolvedPath]);
    const realPath = resolveRealPathForNearestExistingPath(resolvedPath);
    if (realPath) {
        candidatePaths.add(realPath);
    }

    if (!Array.from(candidatePaths).every((candidatePath) => allowedRoots.some((root) => isPathInsideRoot(candidatePath, root)))) {
        throw new SandboxAccessError(inputPath, realPath ?? resolvedPath, sandboxMode);
    }

    return resolvedPath;
}

export function resolvePathForRead(
    inputPath: string,
    context: {
        cwd: string;
        projectRoot: string;
        sandboxMode?: SandboxMode;
        allowedPaths?: string[];
        approvedReadPaths?: string[];
    },
): string {
    const suspiciousPathReason = describeSuspiciousPath(inputPath);
    if (suspiciousPathReason) {
        throw new Error(`Suspicious path is not allowed for sandboxed read access: ${inputPath} (${suspiciousPathReason})`);
    }

    const sandboxMode = context.sandboxMode ?? 'project';
    const resolvedPath = path.isAbsolute(inputPath)
        ? path.normalize(inputPath)
        : path.resolve(context.cwd, inputPath);

    if (hasGlobPathPattern(inputPath)) {
        throw new Error(`Glob path is not allowed for direct file reads: ${inputPath}`);
    }

    if (sandboxMode === 'full-access') {
        return resolvedPath;
    }

    const readScope = classifyReadPathScope(inputPath, context);
    if (readScope === 'workspace' || readScope === 'allowed' || readScope === 'internal') {
        return resolvedPath;
    }

    if (isPathApprovedForRead(inputPath, context)) {
        return resolvedPath;
    }

    throw new SandboxAccessError(inputPath, resolveRealPathForNearestExistingPath(resolvedPath) ?? resolvedPath, sandboxMode);
}

function isPathApprovedForRead(
    inputPath: string,
    context: {
        cwd: string;
        approvedReadPaths?: string[];
    },
): boolean {
    const approvedPaths = context.approvedReadPaths ?? [];
    if (approvedPaths.length === 0) {
        return false;
    }

    const targetCandidates = new Set(resolvePermissionCheckPaths(inputPath, context));
    return approvedPaths.some((approvedPath) => {
        for (const candidate of resolvePermissionCheckPaths(approvedPath, context)) {
            if (targetCandidates.has(candidate)) {
                return true;
            }
        }
        return false;
    });
}

export function classifySandboxReadScope(
    inputPath: string,
    context: {
        cwd: string;
        projectRoot: string;
        allowedPaths?: string[];
    },
): 'workspace' | 'allowed' | 'internal' | 'outside' {
    return classifyReadPathScope(inputPath, context);
}

export function isReadPathTrustedBySandbox(
    inputPath: string,
    context: {
        cwd: string;
        projectRoot: string;
        allowedPaths?: string[];
    },
): boolean {
    const resolvedPath = path.isAbsolute(inputPath)
        ? path.normalize(inputPath)
        : path.resolve(context.cwd, inputPath);

    return isPathInWorkspaceRoots(resolvedPath, context)
        || isPathInAllowedReadRoots(resolvedPath, context)
        || isInternalRuntimeReadPath(resolvedPath, context);
}

function tryResolveRealPath(targetPath: string): string | null {
    try {
        return fs.realpathSync.native(targetPath);
    } catch {
        return null;
    }
}

function resolveRealPathForNearestExistingPath(targetPath: string): string | null {
    const pendingSegments: string[] = [];
    let currentPath = targetPath;

    while (!pathExistsForResolution(currentPath)) {
        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
            return null;
        }

        pendingSegments.unshift(path.basename(currentPath));
        currentPath = parentPath;
    }

    const realBasePath = tryResolveRealPath(currentPath);
    if (!realBasePath) {
        return null;
    }

    return pendingSegments.length > 0
        ? path.join(realBasePath, ...pendingSegments)
        : realBasePath;
}

function pathExistsForResolution(targetPath: string): boolean {
    try {
        fs.lstatSync(targetPath);
        return true;
    } catch {
        return false;
    }
}

function getPathCandidates(targetPath: string): string[] {
    const realPath = resolveRealPathForNearestExistingPath(targetPath);
    return realPath && realPath !== targetPath
        ? [targetPath, realPath]
        : [targetPath];
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

export function validateCommandSandbox(
    command: string,
    context: {
        cwd: string;
        projectRoot: string;
        sandboxMode?: SandboxMode;
        allowedPaths?: string[];
    },
): string | undefined {
    const safetyError = validateCommandSafety(command);
    if (safetyError) {
        return safetyError;
    }

    const sensitiveEnvRead = findSensitiveEnvironmentRead(command);
    if (sensitiveEnvRead) {
        return `Command rejected by sandbox: sensitive environment variable read (${sensitiveEnvRead})`;
    }

    const outsideRedirection = findOutsideWorkspaceRedirection(command, context);
    if (outsideRedirection) {
        return `Command rejected by sandbox: redirection outside the allowed workspace (${outsideRedirection})`;
    }

    return undefined;
}

export function createSandboxedCommandEnv(
    env: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
    const allowedProcessKeys = [
        'PATH',
        'HOME',
        'SHELL',
        'USER',
        'LOGNAME',
        'TMPDIR',
        'TMP',
        'TEMP',
        'LANG',
        'LC_ALL',
        'TERM',
        'CI',
        'FORCE_COLOR',
        'NO_COLOR',
    ];
    const result: Record<string, string | undefined> = {};
    for (const key of allowedProcessKeys) {
        if (process.env[key] !== undefined && !isSensitiveEnvKey(key)) {
            result[key] = process.env[key];
        }
    }

    for (const [key, value] of Object.entries(env ?? {})) {
        if (isSensitiveEnvKey(key)) {
            continue;
        }
        result[key] = value;
    }

    result['GIT_EDITOR'] = 'true';
    return result;
}

function findSensitiveEnvironmentRead(command: string): string | undefined {
    const directVariable = command.match(/\$([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*)\b/i);
    if (directVariable?.[1]) {
        return directVariable[1];
    }

    const printenv = command.match(/\b(?:printenv|env)\b[^\n;&|`]*\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*)\b/i);
    if (printenv?.[1]) {
        return printenv[1];
    }

    if (/\b(?:printenv|env|set)\b[^\n;&|`]*\|\s*(?:grep|rg)\b[^\n;&|`]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(command)) {
        return 'secret-like environment filter';
    }

    return undefined;
}

function isSensitiveEnvKey(key: string): boolean {
    return /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE|SESSION)/i.test(key);
}

function findOutsideWorkspaceRedirection(
    command: string,
    context: {
        cwd: string;
        projectRoot: string;
        sandboxMode?: SandboxMode;
        allowedPaths?: string[];
    },
): string | undefined {
    const redirectionPattern = /(?:^|\s)(?:\d?>{1,2}|&>|<)\s*(["']?)([^"'\s;&|`]+)\1/g;
    let match: RegExpExecArray | null;
    while ((match = redirectionPattern.exec(command)) !== null) {
        const rawTarget = match[2];
        if (!rawTarget || rawTarget === '&1' || rawTarget === '&2' || rawTarget.startsWith('/dev/')) {
            continue;
        }

        const target = rawTarget.startsWith('~')
            ? rawTarget
            : path.isAbsolute(rawTarget)
                ? path.normalize(rawTarget)
                : path.resolve(context.cwd, rawTarget);

        if (rawTarget.startsWith('~')) {
            return rawTarget;
        }

        try {
            resolvePathWithinProject(target, context);
        } catch (error) {
            if (isSandboxAccessError(error)) {
                return rawTarget;
            }
            throw error;
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

    return Array.from(new Set(
        roots.flatMap((root) => getPathCandidates(root)),
    ));
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
    const relativePath = path.relative(rootPath, targetPath);
    return relativePath === ''
        || (
            !relativePath.startsWith('..')
            && !path.isAbsolute(relativePath)
        );
}
