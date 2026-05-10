import {
    type ApprovalPolicy,
    type CommandTemplateSettings,
    type PermissionSettings,
} from './types.js';

export function withOptionalProp<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
    return value === undefined
        ? {}
        : { [key]: value } as Record<K, V>;
}

export function normalizeOptionalNumber(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return value;
}

export function normalizeExtension(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
        return '';
    }
    return normalized.startsWith('.') ? normalized : `.${normalized}`;
}

export function normalizeInstructionList(value: string[] | undefined): string[] {
    return (value ?? []).map((entry) => entry.trim()).filter(Boolean);
}

export function normalizeCommandTemplates(
    value: Record<string, CommandTemplateSettings> | undefined,
): Record<string, CommandTemplateSettings> {
    const templates: Record<string, CommandTemplateSettings> = {};

    for (const [name, template] of Object.entries(value ?? {})) {
        const normalizedName = name.trim();
        const prompt = template.prompt?.trim() || '';
        if (!normalizedName || !prompt) {
            continue;
        }

        const description = template.description?.trim() || undefined;
        const agent = template.agent?.trim() || undefined;
        templates[normalizedName] = {
            prompt,
            ...(description !== undefined ? { description } : {}),
            ...(agent !== undefined ? { agent } : {}),
        };
    }

    return templates;
}

const VALID_PERMISSION_MODES = new Set<NonNullable<PermissionSettings['defaultMode']>>([
    'allow',
    'ask',
    'deny',
    'auto',
    'plan',
    'default',
    'bypassPermissions',
    'acceptEdits',
]);

export function normalizePermissionSettings(settings: PermissionSettings | undefined): PermissionSettings {
    const defaultMode = settings?.defaultMode && VALID_PERMISSION_MODES.has(settings.defaultMode)
        ? settings.defaultMode
        : 'ask';
    const approvalPolicy = normalizeApprovalPolicy(settings?.approvalPolicy, defaultMode);
    const allowedTools = normalizeToolNameList(settings?.allowedTools);
    const disallowedTools = normalizeToolNameList(settings?.disallowedTools);

    return {
        defaultMode,
        tools: Object.fromEntries(
            Object.entries(settings?.tools ?? {})
                .map(([toolName, mode]) => [toolName.trim(), mode] as const)
                .filter(([toolName, mode]) => toolName.length > 0 && !!mode && VALID_PERMISSION_MODES.has(mode)),
        ),
        approvalPolicy,
        ...(allowedTools.length > 0 ? { allowedTools } : {}),
        ...(disallowedTools.length > 0 ? { disallowedTools } : {}),
    };
}

function normalizeApprovalPolicy(
    value: ApprovalPolicy | undefined,
    defaultMode: PermissionSettings['defaultMode'],
): Extract<ApprovalPolicy, 'strict' | 'balanced' | 'workspace_auto'> {
    if (value === 'strict' || value === 'balanced' || value === 'workspace_auto') {
        return value;
    }

    if (defaultMode === 'allow') {
        return 'workspace_auto';
    }

    if (defaultMode === 'deny' || defaultMode === 'ask') {
        return 'strict';
    }

    return 'balanced';
}

function normalizeToolNameList(values: string[] | undefined): string[] {
    return (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean);
}
