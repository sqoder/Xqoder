export type ChatInteractionKind =
    | 'casual'
    | 'identity'
    | 'capability'
    | 'project_explanation'
    | 'engineering_task'
    | 'config_or_runtime';

export interface ChatInteractionRoute {
    kind: ChatInteractionKind;
    normalizedPrompt: string;
    usesStructuredResponse: boolean;
    includesRuntimeIdentity: boolean;
    augmentsProjectContext: boolean;
    addsCapabilityGuidance: boolean;
}
