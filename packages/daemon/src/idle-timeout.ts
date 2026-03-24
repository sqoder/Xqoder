export const DEFAULT_DAEMON_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const DAEMON_IDLE_TIMEOUT_ENV = 'XQODER_DAEMON_IDLE_TIMEOUT';

const UNIT_TO_MS = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 60 * 60_000,
} as const;

type DurationUnit = keyof typeof UNIT_TO_MS;

export interface ResolvedDaemonIdleTimeout {
    timeoutMs: number;
    disabled: boolean;
    source: 'default' | 'env';
    rawValue?: string;
    warning?: string;
}

export function parseDaemonIdleTimeout(rawValue: string): number | undefined {
    const trimmed = rawValue.trim().toLowerCase();
    if (!trimmed) {
        return undefined;
    }

    const match = /^(\d+)(ms|s|m|h)?$/u.exec(trimmed);
    if (!match) {
        return undefined;
    }

    const amount = Number.parseInt(match[1] ?? '', 10);
    if (!Number.isSafeInteger(amount) || amount < 0) {
        return undefined;
    }

    const unit = (match[2] ?? 'ms') as DurationUnit;
    const timeoutMs = amount * UNIT_TO_MS[unit];
    return Number.isSafeInteger(timeoutMs) ? timeoutMs : undefined;
}

export function resolveDaemonIdleTimeout(env: NodeJS.ProcessEnv = process.env): ResolvedDaemonIdleTimeout {
    const rawValue = env[DAEMON_IDLE_TIMEOUT_ENV];
    if (rawValue === undefined || rawValue.trim() === '') {
        return {
            timeoutMs: DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
            disabled: false,
            source: 'default',
        };
    }

    const timeoutMs = parseDaemonIdleTimeout(rawValue);
    if (timeoutMs === undefined) {
        return {
            timeoutMs: DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
            disabled: false,
            source: 'default',
            rawValue,
            warning: `Invalid ${DAEMON_IDLE_TIMEOUT_ENV}="${rawValue}". Expected a non-negative duration like "1800000", "30m", "45s", or "1h". Falling back to 30m.`,
        };
    }

    return {
        timeoutMs,
        disabled: timeoutMs === 0,
        source: 'env',
        rawValue,
    };
}

export function getDaemonIdleCheckIntervalMs(timeoutMs: number): number {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return 60_000;
    }

    return Math.max(1_000, Math.min(60_000, Math.floor(timeoutMs / 4)));
}

export function formatDaemonIdleTimeout(timeoutMs: number): string {
    if (timeoutMs === 0) {
        return 'disabled';
    }
    if (timeoutMs % UNIT_TO_MS.h === 0) {
        return `${timeoutMs / UNIT_TO_MS.h}h`;
    }
    if (timeoutMs % UNIT_TO_MS.m === 0) {
        return `${timeoutMs / UNIT_TO_MS.m}m`;
    }
    if (timeoutMs % UNIT_TO_MS.s === 0) {
        return `${timeoutMs / UNIT_TO_MS.s}s`;
    }
    return `${timeoutMs}ms`;
}
