import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';

const repoRoot = path.resolve(import.meta.dir, '..');
const srcRoot = path.join(repoRoot, 'src');

type LayerName =
    | 'bootstrap'
    | 'interfaces'
    | 'application'
    | 'domain'
    | 'infrastructure'
    | 'shared'
    | 'commands'
    | 'core'
    | 'platform'
    | 'infra'
    | 'services'
    | 'features'
    | 'plugins'
    | 'ux';

interface ImportViolation {
    file: string;
    specifier: string;
    resolvedLayer: LayerName;
}

const IMPORT_SPECIFIER_PATTERN = /\b(?:import|export)\b[\s\S]*?\bfrom\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const LAYER_ALIAS_PREFIXES: Array<{ prefix: string; layer: LayerName }> = [
    { prefix: '@xqoder/bootstrap', layer: 'bootstrap' },
    { prefix: '@xqoder/interfaces', layer: 'interfaces' },
    { prefix: '@xqoder/application', layer: 'application' },
    { prefix: '@xqoder/domain', layer: 'domain' },
    { prefix: '@xqoder/infrastructure', layer: 'infrastructure' },
    { prefix: '@xqoder/foundation-shared', layer: 'shared' },
    { prefix: '@xqoder/shared', layer: 'shared' },
    { prefix: '@xqoder/protocol', layer: 'shared' },
    { prefix: '@xqoder/llm-api', layer: 'shared' },
    { prefix: '@xqoder/permissions', layer: 'infrastructure' },
    { prefix: '@xqoder/agent', layer: 'domain' },
    { prefix: '@xqoder/core-runtime', layer: 'application' },
    { prefix: '@xqoder/core-skills', layer: 'application' },
    { prefix: '@xqoder/core-output-styles', layer: 'application' },
    { prefix: '@xqoder/core-tasks', layer: 'application' },
    { prefix: '@xqoder/core-cron', layer: 'application' },
    { prefix: '@xqoder/plugin-sdk', layer: 'domain' },
    { prefix: '@xqoder/provider-openai', layer: 'infrastructure' },
    { prefix: '@xqoder/provider-anthropic', layer: 'infrastructure' },
    { prefix: '@xqoder/runtime', layer: 'infrastructure' },
    { prefix: '@xqoder/deploy', layer: 'infrastructure' },
    { prefix: '@xqoder/storage-sqlite', layer: 'infrastructure' },
    { prefix: '@xqoder/workflow', layer: 'domain' },
];

function collectFiles(relativeDir: string): string[] {
    const directory = path.join(srcRoot, relativeDir);
    const files: string[] = [];
    const walk = (currentDir: string): void => {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const nextPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(nextPath);
                continue;
            }
            if (/\.(ts|tsx)$/.test(entry.name)) {
                files.push(nextPath);
            }
        }
    };
    walk(directory);
    return files;
}

function getImportSpecifiers(source: string): string[] {
    const specifiers: string[] = [];
    for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
        const specifier = match[1] ?? match[2];
        if (specifier) {
            specifiers.push(specifier);
        }
    }
    return specifiers;
}

function resolveLayer(filePath: string, specifier: string): LayerName | null {
    if (specifier.startsWith('.')) {
        const resolvedPath = path.resolve(path.dirname(filePath), specifier);
        const relativePath = path.relative(srcRoot, resolvedPath);
        if (relativePath.startsWith('..')) {
            return null;
        }
        const [topLevelDir] = relativePath.split(path.sep);
        return (topLevelDir as LayerName) || null;
    }

    const alias = LAYER_ALIAS_PREFIXES.find(({ prefix }) => specifier === prefix || specifier.startsWith(`${prefix}/`));
    return alias?.layer ?? null;
}

function collectViolations(
    scopeDir: string,
    forbiddenLayers: LayerName[],
): ImportViolation[] {
    const violations: ImportViolation[] = [];

    for (const filePath of collectFiles(scopeDir)) {
        const source = fs.readFileSync(filePath, 'utf-8');
        for (const specifier of getImportSpecifiers(source)) {
            const resolvedLayer = resolveLayer(filePath, specifier);
            if (resolvedLayer && forbiddenLayers.includes(resolvedLayer)) {
                violations.push({
                    file: path.relative(repoRoot, filePath),
                    specifier,
                    resolvedLayer,
                });
            }
        }
    }

    return violations;
}

function formatViolations(violations: ImportViolation[]): string {
    return violations
        .map((violation) => `${violation.file} -> ${violation.specifier} (${violation.resolvedLayer})`)
        .join('\n');
}

describe('architecture guardrails', () => {
    it('keeps the domain layer isolated from higher-level layers', () => {
        const violations = collectViolations('domain', ['application', 'interfaces', 'infrastructure']);
        expect(formatViolations(violations)).toBe('');
    });

    it('keeps the shared layer free of app-specific dependencies', () => {
        const violations = collectViolations('shared', ['bootstrap', 'interfaces', 'application', 'domain', 'infrastructure']);
        expect(formatViolations(violations)).toBe('');
    });

    it('prevents new-layer code from reaching back into legacy implementation directories', () => {
        const scopes = ['application', 'domain', 'shared'];
        const violations = scopes.flatMap((scope) =>
            collectViolations(scope, ['commands', 'core', 'platform', 'infra', 'services']),
        );
        expect(formatViolations(violations)).toBe('');
    });

    it('keeps the core-cron layer isolated from infrastructure and domain layers', () => {
        const violations = collectViolations('core/cron', ['infrastructure', 'domain']);
        expect(formatViolations(violations)).toBe('');
    });
});
