import {
    type HookEventName,
    type HookHandlerConfig,
    type HookMatcherConfig,
    type HooksSettings,
    isHookEventName,
} from './types.js';
import { normalizeOptionalNumber } from './config-normalizers-common.js';

export function mergeHooksSettings(
    base: HooksSettings | undefined,
    override: HooksSettings | undefined,
): HooksSettings {
    const merged = normalizeHooksSettings(base);
    const normalizedOverride = normalizeHooksSettings(override);

    for (const eventName of Object.keys(normalizedOverride) as HookEventName[]) {
        const matcherGroups = normalizedOverride[eventName] ?? [];
        merged[eventName] = [
            ...(merged[eventName] ?? []),
            ...matcherGroups,
        ];
    }

    return merged;
}

export function normalizeHooksSettings(settings: HooksSettings | undefined): HooksSettings {
    const entries: Array<[HookEventName, HookMatcherConfig[]]> = [];
    for (const [eventName, matcherGroups] of Object.entries(settings ?? {})) {
        const normalizedEventName = eventName.trim();
        const normalizedMatcherGroups = normalizeHookMatcherConfigs(matcherGroups);
        if (isHookEventName(normalizedEventName) && normalizedMatcherGroups.length > 0) {
            entries.push([normalizedEventName, normalizedMatcherGroups]);
        }
    }

    return Object.fromEntries(entries);
}

function normalizeHookMatcherConfigs(matcherGroups: HookMatcherConfig[] | undefined): HookMatcherConfig[] {
    const normalized: HookMatcherConfig[] = [];
    for (const matcherGroup of matcherGroups ?? []) {
        const hooks = normalizeHookHandlerConfigs(matcherGroup?.hooks);
        if (hooks.length === 0) {
            continue;
        }

        const matcher = matcherGroup?.matcher?.trim() || undefined;
        normalized.push({
            hooks,
            ...(matcher !== undefined ? { matcher } : {}),
        });
    }

    return normalized;
}

function normalizeHookHandlerConfigs(hooks: HookHandlerConfig[] | undefined): HookHandlerConfig[] {
    return (hooks ?? [])
        .map((hook) => normalizeHookHandlerConfig(hook))
        .filter((hook): hook is HookHandlerConfig => hook !== null);
}

function normalizeHookHandlerConfig(hook: HookHandlerConfig | undefined): HookHandlerConfig | null {
    if (!hook || typeof hook !== 'object') {
        return null;
    }

    const timeout = normalizeOptionalNumber(hook.timeout);
    switch (hook.type) {
        case 'command': {
            if (!hook.command?.trim()) {
                return null;
            }
            const shell = hook.shell?.trim() || undefined;
            return {
                type: 'command',
                command: hook.command.trim(),
                async: hook.async === true,
                ...(shell !== undefined ? { shell } : {}),
                ...(timeout !== undefined ? { timeout } : {}),
            };
        }
        case 'http': {
            if (!hook.url?.trim()) {
                return null;
            }
            const headers = Object.fromEntries(
                Object.entries(hook.headers ?? {})
                    .map(([name, value]) => [name.trim(), value] as const)
                    .filter(([name, value]) => name.length > 0 && typeof value === 'string' && value.trim().length > 0),
            );
            return {
                type: 'http',
                url: hook.url.trim(),
                ...(Object.keys(headers).length > 0 ? { headers } : {}),
                ...(timeout !== undefined ? { timeout } : {}),
            };
        }
        case 'prompt': {
            if (!hook.prompt?.trim()) {
                return null;
            }
            const model = hook.model?.trim() || undefined;
            return {
                type: 'prompt',
                prompt: hook.prompt.trim(),
                ...(model !== undefined ? { model } : {}),
                ...(timeout !== undefined ? { timeout } : {}),
            };
        }
        case 'agent': {
            if (!hook.prompt?.trim()) {
                return null;
            }
            const agent = hook.agent?.trim() || undefined;
            const model = hook.model?.trim() || undefined;
            return {
                type: 'agent',
                prompt: hook.prompt.trim(),
                ...(agent !== undefined ? { agent } : {}),
                ...(model !== undefined ? { model } : {}),
                ...(timeout !== undefined ? { timeout } : {}),
            };
        }
        default:
            return null;
    }
}
