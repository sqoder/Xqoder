import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
    MvpHardStopCondition,
    MvpRuntimeConfig,
    MvpSoftStopCondition,
    MvpStopConditionConfig,
} from './types.js';

const DEFAULT_STOP_CONDITIONS: MvpStopConditionConfig = {
    hard: ['all_tests_pass'],
    soft: [],
    maxLoops: 15,
};

const DEFAULT_RUNTIME_CONFIG: MvpRuntimeConfig = {
    baselineCheck: true,
    distillVerifier: true,
    stopConditions: DEFAULT_STOP_CONDITIONS,
};

const SECURITY_ONLY_KEYS = [
    'apiBaseUrl',
    'trustedShellPrefixes',
    'maxShellTimeoutMs',
    'allowedWriteRoots',
] as const;

const RULE_FILE_CANDIDATES = ['xqoder.md', 'XQODER.md'];

type SimpleYamlValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export function loadMvpRuntimeConfig(
    projectRoot: string,
    warn: (message: string) => void = (message) => console.warn(message),
): MvpRuntimeConfig {
    const ruleFile = findRuleFile(projectRoot);
    if (!ruleFile) {
        return cloneRuntimeConfig(DEFAULT_RUNTIME_CONFIG);
    }

    const content = fs.readFileSync(ruleFile, 'utf-8');
    const frontmatter = extractFrontmatter(content);
    if (!frontmatter) {
        return cloneRuntimeConfig(DEFAULT_RUNTIME_CONFIG);
    }

    const parsed = parseSimpleYaml(frontmatter);
    const scopedConfig = readRecord(parsed['xqoder']);
    if (!scopedConfig) {
        return cloneRuntimeConfig(DEFAULT_RUNTIME_CONFIG);
    }

    const blockedKeys = SECURITY_ONLY_KEYS.filter((key) => key in scopedConfig);
    if (blockedKeys.length > 0) {
        warn(
            `[xqoder] WARNING: Project-level xqoder.md attempted to set security-only fields: ${blockedKeys.join(', ')}. These fields are ignored.`,
        );
    }

    const sanitizedConfig = { ...scopedConfig };
    for (const key of blockedKeys) {
        delete sanitizedConfig[key];
    }

    return {
        baselineCheck: readBoolean(sanitizedConfig['baselineCheck']) ?? DEFAULT_RUNTIME_CONFIG.baselineCheck,
        distillVerifier: readBoolean(sanitizedConfig['distillVerifier']) ?? DEFAULT_RUNTIME_CONFIG.distillVerifier,
        stopConditions: normalizeStopConditions(
            readRecord(sanitizedConfig['stopConditions']),
            sanitizedConfig,
        ),
    };
}

export function extractFrontmatter(content: string): string | null {
    if (!content.startsWith('---\n')) {
        return null;
    }

    const endIndex = content.indexOf('\n---', 4);
    if (endIndex === -1) {
        return null;
    }

    return content.slice(4, endIndex).trim();
}

function findRuleFile(projectRoot: string): string | null {
    for (const candidate of RULE_FILE_CANDIDATES) {
        const absolutePath = path.join(projectRoot, candidate);
        if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
            return absolutePath;
        }
    }

    return null;
}

function cloneRuntimeConfig(config: MvpRuntimeConfig): MvpRuntimeConfig {
    return {
        baselineCheck: config.baselineCheck,
        distillVerifier: config.distillVerifier,
        stopConditions: {
            hard: [...config.stopConditions.hard],
            soft: [...config.stopConditions.soft],
            maxLoops: config.stopConditions.maxLoops,
            ...(config.stopConditions.timeoutMs !== undefined
                ? { timeoutMs: config.stopConditions.timeoutMs }
                : {}),
        },
    };
}

function normalizeStopConditions(
    source: Record<string, unknown> | null,
    fallbackSource: Record<string, unknown> | null = null,
): MvpStopConditionConfig {
    if (!source) {
        return {
            hard: [...DEFAULT_STOP_CONDITIONS.hard],
            soft: [...DEFAULT_STOP_CONDITIONS.soft],
            maxLoops: readPositiveInteger(fallbackSource?.['maxLoops']) ?? DEFAULT_STOP_CONDITIONS.maxLoops,
            ...(readPositiveInteger(fallbackSource?.['timeoutMs']) !== undefined
                ? { timeoutMs: readPositiveInteger(fallbackSource?.['timeoutMs']) }
                : {}),
        };
    }

    const timeoutMs = readPositiveInteger(source['timeoutMs'])
        ?? readPositiveInteger(fallbackSource?.['timeoutMs']);

    return {
        hard: normalizeHardConditions(source['hard']),
        soft: normalizeSoftConditions(source['soft']),
        maxLoops: readPositiveInteger(source['maxLoops'])
            ?? readPositiveInteger(fallbackSource?.['maxLoops'])
            ?? DEFAULT_STOP_CONDITIONS.maxLoops,
        ...(timeoutMs !== undefined
            ? { timeoutMs }
            : {}),
    };
}

function normalizeHardConditions(value: unknown): MvpHardStopCondition[] {
    const allowed: MvpHardStopCondition[] = [
        'all_tests_pass',
        'build_succeeds',
        'no_lint_errors',
        'no_regression',
    ];
    const items = readStringArray(value).filter((entry): entry is MvpHardStopCondition => {
        return (allowed as string[]).includes(entry);
    });

    return items.length > 0 ? items : [...DEFAULT_STOP_CONDITIONS.hard];
}

function normalizeSoftConditions(value: unknown): MvpSoftStopCondition[] {
    const allowed: MvpSoftStopCondition[] = [
        'lint_errors_not_worse',
        'coverage_maintained',
    ];
    return readStringArray(value).filter((entry): entry is MvpSoftStopCondition => {
        return (allowed as string[]).includes(entry);
    });
}

function parseSimpleYaml(source: string): Record<string, SimpleYamlValue> {
    const lines = source
        .split('\n')
        .map((line) => line.replace(/\t/g, '  '))
        .filter((line) => line.trim().length > 0);
    const root: Record<string, SimpleYamlValue> = {};
    const stack: Array<{ indent: number; container: Record<string, SimpleYamlValue> | unknown[] }> = [{
        indent: -1,
        container: root,
    }];

    for (let index = 0; index < lines.length; index += 1) {
        const rawLine = lines[index];
        const indent = countIndent(rawLine);
        const line = rawLine.trim();
        if (line.startsWith('#')) {
            continue;
        }

        while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
            stack.pop();
        }

        const current = stack[stack.length - 1]!.container;
        if (line.startsWith('- ')) {
            if (!Array.isArray(current)) {
                continue;
            }
            current.push(parseScalar(line.slice(2).trim()));
            continue;
        }

        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        const rawValue = line.slice(separatorIndex + 1).trim();

        if (rawValue.length > 0) {
            if (!Array.isArray(current)) {
                current[key] = parseScalar(rawValue);
            }
            continue;
        }

        const nextLine = lines[index + 1];
        const nextTrimmed = nextLine?.trim() ?? '';
        const nextIndent = nextLine ? countIndent(nextLine) : -1;
        const nextIsArray = nextLine !== undefined && nextIndent > indent && nextTrimmed.startsWith('- ');
        const childContainer: Record<string, SimpleYamlValue> | unknown[] = nextIsArray ? [] : {};

        if (!Array.isArray(current)) {
            current[key] = childContainer;
            stack.push({
                indent,
                container: childContainer,
            });
        }
    }

    return root;
}

function countIndent(line: string): number {
    return line.length - line.trimStart().length;
}

function parseScalar(value: string): string | number | boolean | null {
    const normalized = value.trim();
    if (normalized === 'true') {
        return true;
    }
    if (normalized === 'false') {
        return false;
    }
    if (normalized === 'null') {
        return null;
    }
    if (/^-?\d+$/.test(normalized)) {
        return Number.parseInt(normalized, 10);
    }
    if (/^-?\d+\.\d+$/.test(normalized)) {
        return Number.parseFloat(normalized);
    }
    if (
        (normalized.startsWith('"') && normalized.endsWith('"'))
        || (normalized.startsWith('\'') && normalized.endsWith('\''))
    ) {
        return normalized.slice(1, -1);
    }
    return normalized;
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function readBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
        ? value
        : undefined;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
        : [];
}
