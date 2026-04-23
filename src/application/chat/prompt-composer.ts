import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    resolveAgentLLMConfig,
    resolveDefaultAgentName,
    type SandboxSettings,
    type XQoderConfig,
} from '@xqoder/shared';
import { resolveChatInteraction } from './interaction-router.js';
import type { ChatInteractionRoute } from './interaction-types.js';
import {
    buildBehaviorLayer,
    buildCapabilityGuidanceLayer,
    buildDirectResponseLayer,
    buildPermissionHintLine,
    buildProjectHintLine,
    buildRuntimeIdentityLayer,
    buildStructuredResponseLayer,
    joinPromptLayers,
} from './prompt-layers.js';

const MAX_PROJECT_ENTRIES = 24;
const MAX_README_CHARS = 2400;

export interface ChatSystemPromptOptions {
    structuredOutput?: boolean;
    runtimeIdentity?: ChatRuntimeIdentity;
}

export interface ChatRuntimeIdentity {
    provider: string;
    model: string;
}

export function buildChatSystemPrompt(
    sandbox: SandboxSettings,
    cwd?: string,
    options: ChatSystemPromptOptions = {},
): string {
    const structuredOutput = options.structuredOutput ?? true;

    return joinPromptLayers([
        'You are XQoder, an AI programming assistant working in the terminal.',
        [
            'How you work:',
            `- ${buildPermissionHintLine(sandbox)}`,
            `- ${buildProjectHintLine(cwd)}`,
            buildBehaviorLayer(),
        ].join('\n'),
        buildRuntimeIdentityLayer(options.runtimeIdentity),
        structuredOutput ? buildStructuredResponseLayer() : buildDirectResponseLayer(),
    ]);
}

export function shouldUseStructuredEngineeringResponse(prompt: string): boolean {
    return resolveChatInteraction(prompt).usesStructuredResponse;
}

export function resolveChatRuntimeIdentity(
    config: XQoderConfig,
    agentName?: string,
    modelOverride?: string,
): ChatRuntimeIdentity {
    const llmConfig = resolveAgentLLMConfig(config, agentName ?? resolveDefaultAgentName(config), {
        model: modelOverride,
    });
    return {
        provider: llmConfig.provider,
        model: llmConfig.model,
    };
}

export function buildChatPromptAppendix(
    prompt: string,
    sandbox: SandboxSettings,
    cwd: string | undefined,
    runtimeIdentity?: ChatRuntimeIdentity,
): string {
    return buildChatPromptAppendixFromRoute(
        resolveChatInteraction(prompt),
        sandbox,
        cwd,
        runtimeIdentity,
    );
}

export function buildChatPromptAppendixFromRoute(
    interaction: ChatInteractionRoute,
    sandbox: SandboxSettings,
    cwd: string | undefined,
    runtimeIdentity?: ChatRuntimeIdentity,
): string {
    return joinPromptLayers([
        buildChatSystemPrompt(sandbox, cwd, {
            structuredOutput: interaction.usesStructuredResponse,
            runtimeIdentity: interaction.includesRuntimeIdentity ? runtimeIdentity : undefined,
        }),
        interaction.addsCapabilityGuidance ? buildCapabilityGuidanceLayer() : undefined,
    ]);
}

export function buildAutoProjectContext(cwd: string): string {
    const resolvedCwd = path.resolve(cwd);
    const sections: string[] = [`Project root: ${resolvedCwd}`];

    try {
        const entries = fs.readdirSync(resolvedCwd, { withFileTypes: true })
            .filter((entry) => !['.git', 'node_modules', 'dist', '.xqoder'].includes(entry.name))
            .sort((left, right) => left.name.localeCompare(right.name))
            .slice(0, MAX_PROJECT_ENTRIES)
            .map((entry) => `${entry.isDirectory() ? '[dir]' : '[file]'} ${entry.name}`);
        if (entries.length > 0) {
            sections.push(`Top-level entries:\n${entries.join('\n')}`);
        }
    } catch {
        // ignore directory scan failures and fall back to other context
    }

    const readmeSnippet = readSnippet(path.join(resolvedCwd, 'README.md'), MAX_README_CHARS);
    if (readmeSnippet) {
        sections.push(`README.md snippet:\n${readmeSnippet}`);
    }

    const packageJsonSummary = summarizePackageJson(path.join(resolvedCwd, 'package.json'));
    if (packageJsonSummary) {
        sections.push(`package.json summary:\n${packageJsonSummary}`);
    }

    for (const candidate of ['pyproject.toml', 'Cargo.toml', 'go.mod']) {
        const snippet = readSnippet(path.join(resolvedCwd, candidate), 1200);
        if (snippet) {
            sections.push(`${candidate} snippet:\n${snippet}`);
        }
    }

    return sections.join('\n\n');
}

export function maybeAugmentPromptWithProjectContext(prompt: string, cwd: string): string {
    return maybeAugmentPromptWithProjectContextFromRoute(
        prompt,
        cwd,
        resolveChatInteraction(prompt),
    );
}

export function maybeAugmentPromptWithProjectContextFromRoute(
    prompt: string,
    cwd: string,
    interaction: ChatInteractionRoute,
): string {
    if (!interaction.augmentsProjectContext) {
        return prompt;
    }
    const projectContext = buildAutoProjectContext(cwd);
    if (!projectContext.trim()) {
        return prompt;
    }

    return `${prompt}

[AutoProjectContext]
The following workspace context was gathered automatically because the user asked about the current project/repo. Use it directly instead of asking the user to provide the same files again unless the request still cannot be resolved.

${projectContext}
[/AutoProjectContext]`;
}

function readSnippet(filePath: string, maxChars: number): string | undefined {
    try {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (!content) {
            return undefined;
        }
        return content.length > maxChars
            ? `${content.slice(0, maxChars)}...`
            : content;
    } catch {
        return undefined;
    }
}

function summarizePackageJson(filePath: string): string | undefined {
    try {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
            name?: string;
            version?: string;
            description?: string;
            scripts?: Record<string, string>;
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        const lines = [
            parsed.name ? `name=${parsed.name}` : undefined,
            parsed.version ? `version=${parsed.version}` : undefined,
            parsed.description ? `description=${parsed.description}` : undefined,
            parsed.scripts ? `scripts=${Object.keys(parsed.scripts).join(', ') || '-'}` : undefined,
            parsed.dependencies ? `dependencies=${Object.keys(parsed.dependencies).slice(0, 12).join(', ') || '-'}` : undefined,
            parsed.devDependencies ? `devDependencies=${Object.keys(parsed.devDependencies).slice(0, 12).join(', ') || '-'}` : undefined,
        ].filter((line): line is string => Boolean(line));

        return lines.length > 0 ? lines.join('\n') : undefined;
    } catch {
        return undefined;
    }
}
