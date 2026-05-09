import * as path from 'node:path';

const SENSITIVE_CONFIG_BASENAMES = new Set([
    '.env',
    '.env.local',
    '.env.production',
    '.env.development',
    'config.json',
    'config.toml',
    'package.json',
    'tsconfig.json',
    'bunfig.toml',
]);

const SENSITIVE_READ_BASENAMES = new Set([
    '.npmrc',
    '.pypirc',
    '.netrc',
    '.dockercfg',
    '.env',
    '.env.local',
    '.env.production',
    '.env.development',
    'id_rsa',
    'id_dsa',
    'id_ecdsa',
    'id_ed25519',
]);

const SENSITIVE_READ_DIR_SEGMENTS = new Set([
    '.aws',
    '.ssh',
    '.gnupg',
    '.kube',
    '.docker',
]);
const SENSITIVE_AGENT_CONFIG_DIR_SEGMENTS = new Set([
    '.xqoder',
    '.codex',
    '.omc',
]);
const SENSITIVE_AGENT_CONFIG_BASENAMES = new Set([
    'config.json',
    'config.toml',
]);

const PROTECTED_PATH_DIR_SEGMENTS = new Set([
    '.aws',
    '.codex',
    '.docker',
    '.git',
    '.gnupg',
    '.hg',
    '.kube',
    '.omc',
    '.ssh',
    '.svn',
    '.xqoder',
]);

const PROTECTED_PATH_BASENAMES = new Set([
    '.bash_login',
    '.bash_profile',
    '.bashrc',
    '.git-credentials',
    '.gitconfig',
    '.netrc',
    '.npmrc',
    '.profile',
    '.zprofile',
    '.zshenv',
    '.zshrc',
]);

const GIT_CLEAN_FORCE_DELETE_PATTERN = /\bgit\s+clean\b(?=[^;&|`$()]*?(?:-[A-Za-z]*f[A-Za-z]*|--force)\b)(?=[^;&|`$()]*?(?:-[A-Za-z]*d[A-Za-z]*|--directory)\b)/i;

const DANGEROUS_COMMAND_PATTERNS = [
    /\brm\s+-rf\b/i,
    /\bgit\s+reset\s+--hard\b/i,
    GIT_CLEAN_FORCE_DELETE_PATTERN,
    /\b(?:DROP|TRUNCATE)\s+TABLE\b/i,
    /\bkubectl\s+delete\b/i,
    /\bdd\s+if=/i,
    /\bsudo(?:\s|$)/i,
    /\bmkfs\b/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\b(?:curl|wget)\b[^|]*\|\s*(?:sh|bash)\b/i,
    /\bchmod\s+-R\s+777\b/i,
    /\bchown\s+-R\b/i,
];

const FORBIDDEN_COMMAND_PATTERNS = [
    /\bgit\s+reset\s+--hard\b/i,
    GIT_CLEAN_FORCE_DELETE_PATTERN,
    /\bkubectl\s+delete\b/i,
    /\bdd\s+if=/i,
];

export function isSensitiveConfigPath(targetPath: string): boolean {
    const normalized = path.basename(targetPath.trim().toLowerCase());
    return SENSITIVE_CONFIG_BASENAMES.has(normalized);
}

export function isSensitiveReadPath(targetPath: string): boolean {
    const trimmed = targetPath.trim();
    if (!trimmed) {
        return false;
    }

    const normalized = path.normalize(trimmed).toLowerCase();
    const basename = path.basename(normalized);
    const segments = normalized.split(path.sep).filter(Boolean);

    if (basename.startsWith('.env') || SENSITIVE_READ_BASENAMES.has(basename)) {
        return true;
    }

    if (segments.some((segment) => SENSITIVE_READ_DIR_SEGMENTS.has(segment))) {
        return true;
    }

    if (
        SENSITIVE_AGENT_CONFIG_BASENAMES.has(basename)
        && segments.some((segment) => SENSITIVE_AGENT_CONFIG_DIR_SEGMENTS.has(segment))
    ) {
        return true;
    }

    if (/^id_(?:rsa|dsa|ecdsa|ed25519)$/i.test(basename)) {
        return true;
    }

    return /\.(?:pem|key|p12|pfx|crt)$/i.test(basename);
}

export function isProtectedPath(targetPath: string): boolean {
    const trimmed = targetPath.trim();
    if (!trimmed) {
        return false;
    }

    const normalized = path.normalize(trimmed).toLowerCase();
    const segments = normalized.split(/[\\/]+/).filter(Boolean);
    const basename = segments[segments.length - 1] ?? path.basename(normalized);

    return PROTECTED_PATH_BASENAMES.has(basename)
        || segments.some((segment) => PROTECTED_PATH_DIR_SEGMENTS.has(segment));
}

export function isPathOutsideProject(targetPath: string, projectRoot: string | undefined): boolean {
    if (!projectRoot?.trim()) {
        return false;
    }

    const resolvedTarget = path.resolve(projectRoot, targetPath);
    const normalizedRoot = path.resolve(projectRoot);
    const relative = path.relative(normalizedRoot, resolvedTarget);
    return relative.startsWith('..') || path.isAbsolute(relative) && relative !== '';
}

export function isDangerousCommand(command: string): boolean {
    const normalized = command.trim();
    if (!normalized) {
        return false;
    }
    return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isForbiddenCommand(command: string): boolean {
    const normalized = command.trim();
    if (!normalized) {
        return false;
    }
    return FORBIDDEN_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isUncPath(targetPath: string): boolean {
    const trimmed = targetPath.trim();
    return /^\\\\[^\\]/.test(trimmed) || /^\/\/[^/]/.test(trimmed);
}

export function hasShellExpansionPathSyntax(targetPath: string): boolean {
    const trimmed = targetPath.trim();
    if (!trimmed) {
        return false;
    }

    return /(^|[^\\])\$[{(A-Za-z_]/.test(trimmed)
        || /%[A-Za-z_][A-Za-z0-9_]*%/.test(trimmed)
        || /(^|[\\/])~[A-Za-z0-9._-]*(?:$|[\\/])/.test(trimmed)
        || /(^|[\\/])=[^\\/]/.test(trimmed);
}

export function hasGlobPathPattern(targetPath: string): boolean {
    const trimmed = targetPath.trim();
    return /[*?\[\]{}]/.test(trimmed);
}

export function hasSuspiciousWindowsPathPattern(targetPath: string): boolean {
    const trimmed = targetPath.trim();
    if (!trimmed) {
        return false;
    }

    return /^\\\\[?.]\\/.test(trimmed)
        || /^[A-Za-z]:(?![\\/])/.test(trimmed)
        || /(?:^|[\\/])[^\\/]{1,6}~\d(?:\.[^\\/]*)?(?=$|[\\/])/i.test(trimmed)
        || /(?:^|[\\/])(?:[^\\/.][^\\/]*|\.[^./\\][^\\/]*)[. ](?=$|[\\/])/i.test(trimmed)
        || /^[A-Za-z]:[^\\/]*:[^\\/:][^\\/]*$/.test(trimmed);
}

export function hasSuspiciousPathPattern(targetPath: string): boolean {
    return isUncPath(targetPath)
        || hasShellExpansionPathSyntax(targetPath)
        || hasGlobPathPattern(targetPath)
        || hasSuspiciousWindowsPathPattern(targetPath);
}

export function describeSuspiciousPathPattern(targetPath: string): string[] {
    const reasons: string[] = [];
    if (isUncPath(targetPath)) {
        reasons.push('UNC or network-style path');
    }
    if (hasShellExpansionPathSyntax(targetPath)) {
        reasons.push('shell expansion syntax');
    }
    if (hasGlobPathPattern(targetPath)) {
        reasons.push('glob pattern');
    }
    if (hasSuspiciousWindowsPathPattern(targetPath)) {
        reasons.push('suspicious Windows path pattern');
    }
    return reasons;
}

export function describeSuspiciousPath(targetPath: string): string | undefined {
    const reasons = describeSuspiciousPathPattern(targetPath);
    return reasons.length > 0 ? reasons.join(', ') : undefined;
}
