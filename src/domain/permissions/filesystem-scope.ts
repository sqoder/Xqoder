import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type ReadPathScope = 'workspace' | 'allowed' | 'internal' | 'outside';
export type WritePathScope = 'workspace' | 'internal' | 'outside';

export interface ReadPathScopeContext {
    cwd: string;
    projectRoot: string;
    allowedPaths?: string[] | undefined;
}

export interface WritePathScopeContext {
    cwd: string;
    projectRoot: string;
    allowedPaths?: string[] | undefined;
}

export function resolveReadPath(inputPath: string, context: ReadPathScopeContext): string {
    return path.isAbsolute(inputPath)
        ? path.normalize(inputPath)
        : path.resolve(context.cwd, inputPath);
}

export function resolveWritePath(inputPath: string, context: WritePathScopeContext): string {
    return path.isAbsolute(inputPath)
        ? path.normalize(inputPath)
        : path.resolve(context.cwd, inputPath);
}

export function classifyReadPathScope(inputPath: string, context: ReadPathScopeContext): ReadPathScope {
    const candidatePaths = resolvePermissionCheckPaths(inputPath, context);

    if (candidatePaths.every((candidatePath) => isPathInWorkspaceRoots(candidatePath, context))) {
        return 'workspace';
    }

    if (candidatePaths.every((candidatePath) => isInternalRuntimeReadPath(candidatePath, context))) {
        return 'internal';
    }

    if (candidatePaths.every((candidatePath) => isPathInAllowedReadRoots(candidatePath, context))) {
        return 'allowed';
    }

    return 'outside';
}

export function classifyWritePathScope(inputPath: string, context: WritePathScopeContext): WritePathScope {
    const candidatePaths = resolvePermissionCheckPaths(inputPath, context);

    if (candidatePaths.every((candidatePath) => isInternalRuntimeWritePath(candidatePath, context))) {
        return 'internal';
    }

    if (candidatePaths.every((candidatePath) => isPathInWorkspaceRoots(candidatePath, context))) {
        return 'workspace';
    }

    return 'outside';
}

export function resolvePermissionCheckPaths(
    inputPath: string,
    context: { cwd: string },
): string[] {
    const resolvedPath = path.isAbsolute(inputPath)
        ? path.normalize(inputPath)
        : path.resolve(context.cwd, inputPath);
    const realPath = resolveRealPathForNearestExistingPath(resolvedPath);

    return realPath && realPath !== resolvedPath
        ? [resolvedPath, realPath]
        : [resolvedPath];
}

export function isPathInWorkspaceRoots(targetPath: string, context: ReadPathScopeContext): boolean {
    return getRootCandidates(path.resolve(context.projectRoot))
        .some((root) => isPathInsideRoot(targetPath, root));
}

export function isPathInAllowedReadRoots(targetPath: string, context: ReadPathScopeContext): boolean {
    return (context.allowedPaths ?? [])
        .flatMap((entry) => getRootCandidates(path.resolve(entry)))
        .some((root) => isPathInsideRoot(targetPath, root));
}

export function isInternalRuntimeReadPath(targetPath: string, context: ReadPathScopeContext): boolean {
    const resolvedPath = path.resolve(targetPath);
    return getInternalRuntimeRoots(context.projectRoot)
        .flatMap((root) => getRootCandidates(root))
        .some((root) => isPathInsideRoot(resolvedPath, root));
}

export function isInternalRuntimeWritePath(targetPath: string, context: WritePathScopeContext): boolean {
    const resolvedPath = path.resolve(targetPath);
    const writableRoots = [
        ...getInternalRuntimeRoots(context.projectRoot),
        path.join(path.resolve(context.projectRoot), '.xqoder', 'plans'),
        path.join(path.resolve(context.projectRoot), '.xqoder', 'tmp'),
    ];

    return writableRoots
        .flatMap((root) => getRootCandidates(root))
        .some((root) => isPathInsideRoot(resolvedPath, root));
}

function getRootCandidates(rootPath: string): string[] {
    const realPath = resolveRealPathForNearestExistingPath(rootPath);
    return realPath && realPath !== rootPath
        ? [path.resolve(rootPath), realPath]
        : [path.resolve(rootPath)];
}

export function isPathOutsideWorkspace(inputPath: string, context: ReadPathScopeContext): boolean {
    return classifyReadPathScope(inputPath, context) === 'outside';
}

function getInternalRuntimeRoots(projectRoot: string): string[] {
    const normalizedProjectRoot = path.resolve(projectRoot);
    const homeDir = os.homedir();
    const xqoderRootDir = path.join(homeDir, '.xqoder');
    const xqoderDataDir = path.join(xqoderRootDir, 'data');
    const xqoderRollbackDir = path.join(xqoderDataDir, 'rollbacks');
    const xqoderShareDir = path.join(xqoderDataDir, 'shares');

    return [
        xqoderRootDir,
        xqoderDataDir,
        xqoderRollbackDir,
        xqoderShareDir,
        path.join(normalizedProjectRoot, '.xqoder'),
        path.join(normalizedProjectRoot, '.omc'),
        path.join(normalizedProjectRoot, '.claude'),
    ];
}

function resolveRealPathForNearestExistingPath(targetPath: string): string | null {
    const pendingSegments: string[] = [];
    let currentPath = path.resolve(targetPath);

    while (!pathExistsForResolution(currentPath)) {
        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
            return null;
        }

        pendingSegments.unshift(path.basename(currentPath));
        currentPath = parentPath;
    }

    try {
        const realBasePath = fs.realpathSync.native(currentPath);
        return pendingSegments.length > 0
            ? path.join(realBasePath, ...pendingSegments)
            : realBasePath;
    } catch {
        return null;
    }
}

function pathExistsForResolution(targetPath: string): boolean {
    try {
        fs.lstatSync(targetPath);
        return true;
    } catch {
        return false;
    }
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedRoot = path.resolve(rootPath);
    const relativePath = path.relative(resolvedRoot, resolvedTarget);

    return relativePath === ''
        || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}
