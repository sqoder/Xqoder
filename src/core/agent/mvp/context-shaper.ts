import { orderMvpContextSections } from './freshness.js';
import type {
    MvpCollectedContext,
    MvpContextSection,
    MvpContextTier,
    MvpShapedContext,
} from './types.js';

const FAILURE_SIGNAL_PATTERN = /\b(failed|error|exception|regression|rollback|blocked|timeout|warning)\b/i;

export function shapeMvpContext(context: MvpCollectedContext): MvpShapedContext {
    const nowMs = Date.now();
    const sections = orderMvpContextSections(buildSections(context, nowMs), nowMs);

    return {
        prompt: sections
            .map(renderSection)
            .filter(Boolean)
            .join('\n\n'),
        sections,
    };
}

function buildSections(
    context: MvpCollectedContext,
    nowMs: number,
): MvpContextSection[] {
    const sections: MvpContextSection[] = [{
        title: 'Goal',
        lines: [context.userGoal],
        tier: 'Goal',
        relevanceScore: 1,
        referenceCount: 10,
        updatedAtMs: nowMs,
    }];

    const errorSignals = [
        ...context.recentSystemSignals.filter((line) => FAILURE_SIGNAL_PATTERN.test(line)),
        ...context.recentToolSignals.filter((line) => FAILURE_SIGNAL_PATTERN.test(line)),
    ].slice(-5);
    if (errorSignals.length > 0) {
        sections.push({
            title: 'Current errors',
            lines: errorSignals,
            tier: 'Error',
            relevanceScore: 0.98,
            referenceCount: Math.max(5, errorSignals.length + 2),
            updatedAtMs: nowMs,
        });
    }

    pushSection(sections, 'Target paths', renderTargetPaths(context), 'Active', 0.92, nowMs);
    pushSection(sections, 'Target URLs', context.targetUrls, 'Active', 0.92, nowMs);
    pushSection(sections, 'Related paths', context.relatedPaths, 'Active', 0.75, nowMs);
    pushSection(sections, 'Project rules', renderRules(context), 'Active', 0.88, nowMs);
    pushSection(sections, 'Recent file changes', context.recentFileChanges, 'History', 0.72, nowMs);
    pushSection(sections, 'Recent commands', context.recentCommands, 'History', 0.68, nowMs);
    pushSection(sections, 'Recent tool signals', context.recentToolSignals, 'History', 0.7, nowMs);
    pushSection(sections, 'Relevant git diff', context.gitDiffSnippets, 'Background', 0.52, nowMs);
    pushSection(sections, 'Git status', context.gitStatus, 'Background', 0.4, nowMs);

    return sections;
}

function renderTargetPaths(context: MvpCollectedContext): string[] {
    return context.targetPaths.map((targetPath) => {
        const kind = context.targetPathKinds[targetPath] ?? 'unknown';
        return `${targetPath} (${kind})`;
    });
}

function pushSection(
    sections: MvpContextSection[],
    title: string,
    lines: string[],
    tier: MvpContextTier,
    relevanceScore: number,
    updatedAtMs: number,
): void {
    const normalized = lines
        .map((line) => line.trim())
        .filter(Boolean);
    if (normalized.length === 0) {
        return;
    }

    sections.push({
        title,
        lines: normalized.slice(0, title === 'Relevant git diff' ? 3 : 5),
        tier,
        relevanceScore,
        referenceCount: Math.max(1, normalized.length),
        updatedAtMs,
    });
}

function renderRules(context: MvpCollectedContext): string[] {
    if (context.projectRules.length === 0) {
        return [];
    }

    return context.projectRules
        .map((rule) => `${rule.path}\n${indent(rule.content, '  ')}`);
}

function renderSection(section: MvpContextSection): string {
    const header = `${section.title} [tier=${section.tier}, freshness=${(section.freshnessScore ?? 0).toFixed(2)}]:`;
    const body = section.lines
        .map((line) => line.includes('\n')
            ? `- ${indent(line, '  ').trimStart()}`
            : `- ${line}`)
        .join('\n');

    return `${header}\n${body}`;
}

function indent(value: string, prefix: string): string {
    return value
        .split('\n')
        .map((line) => `${prefix}${line}`)
        .join('\n');
}
