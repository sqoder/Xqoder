import {
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

export function normalizePermissionSettings(settings: PermissionSettings | undefined): PermissionSettings {
    return {
        defaultMode: settings?.defaultMode ?? 'ask',
        tools: Object.fromEntries(
            Object.entries(settings?.tools ?? {})
                .map(([toolName, mode]) => [toolName.trim(), mode] as const)
                .filter(([toolName, mode]) => toolName.length > 0 && (mode === 'allow' || mode === 'ask' || mode === 'deny')),
        ),
    };
}
