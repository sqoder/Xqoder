import {
    resolveDefaultAgentName,
    type XQoderConfig,
} from '@xqoder/shared';
import {
    collectInstructionSources,
    type InstructionSource,
    type InstructionSourceInput,
} from './instruction-sources.js';

export interface ResolvedInstructionSet {
    sources: InstructionSource[];
    orderedInstructions: string[];
}

export function resolveInstructionSet(input: InstructionSourceInput): ResolvedInstructionSet {
    const sources = collectInstructionSources(input);
    const orderedInstructions: string[] = [];
    const seen = new Set<string>();

    for (const source of sources) {
        for (const entry of source.entries) {
            const normalized = entry.trim();
            if (!normalized || seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            orderedInstructions.push(normalized);
        }
    }

    return {
        sources,
        orderedInstructions,
    };
}

export function resolveInstructionAppendix(input: InstructionSourceInput): string | undefined {
    return buildInstructionAppendix(resolveInstructionSet(input));
}

export function resolveAgentInstructionAppendix(input: {
    config: XQoderConfig;
    cwd: string;
    agentName?: string;
    runtimeOverrides?: string[];
    projectRuleCandidates?: string[];
}): string | undefined {
    const resolvedAgentName = input.agentName?.trim() || resolveDefaultAgentName(input.config);
    return resolveInstructionAppendix({
        cwd: input.cwd,
        runtimeOverrides: input.runtimeOverrides,
        projectConfigInstructions: input.config.agents?.[resolvedAgentName]?.instructions,
        userConfigInstructions: input.config.instructions,
        projectRuleCandidates: input.projectRuleCandidates,
    });
}

export function buildInstructionAppendix(resolved: ResolvedInstructionSet): string | undefined {
    if (resolved.sources.length === 0) {
        return undefined;
    }

    const sections = resolved.sources.map((source) => {
        const title = renderSourceTitle(source.name);
        return `${title}:\n${source.entries.map((entry) => `- ${entry}`).join('\n')}`;
    });

    return [
        'Instruction resolver output (higher priority first):',
        ...sections,
    ].join('\n\n');
}

function renderSourceTitle(name: InstructionSource['name']): string {
    switch (name) {
        case 'runtime_override':
            return 'Runtime overrides';
        case 'project_config':
            return 'Project config';
        case 'project_rules':
            return 'Project rule files';
        case 'user_config':
            return 'User config';
        case 'working_memory':
            return 'Working memory / notepad';
        default:
            return 'Instruction source';
    }
}
