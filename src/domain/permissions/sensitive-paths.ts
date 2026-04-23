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

const DANGEROUS_COMMAND_PATTERNS = [
    /\brm\s+-rf\b/i,
    /\bgit\s+reset\s+--hard\b/i,
    /\bgit\s+clean\s+-fd\b/i,
    /\b(?:DROP|TRUNCATE)\s+TABLE\b/i,
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

    if (/^id_(?:rsa|dsa|ecdsa|ed25519)$/i.test(basename)) {
        return true;
    }

    return /\.(?:pem|key|p12|pfx|crt)$/i.test(basename);
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
