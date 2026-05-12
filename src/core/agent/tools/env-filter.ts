import { isSensitiveEnvKey } from './sandbox.js';

export function filterSensitiveEnv(
    parentEnv: NodeJS.ProcessEnv,
    explicit: Record<string, string> | undefined,
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parentEnv)) {
        if (typeof value !== 'string') continue;
        if (isSensitiveEnvKey(key)) continue;
        result[key] = value;
    }
    for (const [key, value] of Object.entries(explicit ?? {})) {
        if (typeof value !== 'string') continue;
        result[key] = value;
    }
    return result;
}
