// P19b — Cron expression parser + next-fire-at computation.
//
// 5-field cron (minute hour dayOfMonth month dayOfWeek). Local time semantics
// — matches the user's wall clock, which is what `xqoder cron create
// "every day at 9am" --at "0 9 * * *"` is expected to do.
//
// Zero third-party deps on purpose: a ~200 line naive "advance minute, check
// match" loop is plenty for v1 scheduling. Pre-computes allowed values per
// field once at parse time so the hot path is O(1) membership tests.

export interface CronExpression {
    readonly minute: ReadonlySet<number>;
    readonly hour: ReadonlySet<number>;
    readonly dayOfMonth: ReadonlySet<number>;
    readonly month: ReadonlySet<number>;
    readonly dayOfWeek: ReadonlySet<number>;
    readonly dayOfMonthRestricted: boolean;
    readonly dayOfWeekRestricted: boolean;
    readonly raw: string;
}

type FieldName = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek';

const FIELD_RANGES: Record<FieldName, readonly [number, number]> = {
    minute: [0, 59],
    hour: [0, 23],
    dayOfMonth: [1, 31],
    month: [1, 12],
    dayOfWeek: [0, 6],
};

const FIELD_ORDER: readonly FieldName[] = [
    'minute',
    'hour',
    'dayOfMonth',
    'month',
    'dayOfWeek',
];

export function isValidCronExpression(raw: string): boolean {
    try {
        parseCronExpression(raw);
        return true;
    } catch {
        return false;
    }
}

export function parseCronExpression(raw: string): CronExpression {
    if (typeof raw !== 'string') {
        throw new Error('Cron expression must be a string');
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        throw new Error('Cron expression must be non-empty');
    }
    const tokens = trimmed.split(/\s+/);
    if (tokens.length !== 5) {
        throw new Error(
            `Cron expression must have exactly 5 fields, got ${tokens.length}`,
        );
    }

    const values: Record<FieldName, Set<number>> = {
        minute: new Set(),
        hour: new Set(),
        dayOfMonth: new Set(),
        month: new Set(),
        dayOfWeek: new Set(),
    };
    const restricted: Record<FieldName, boolean> = {
        minute: false,
        hour: false,
        dayOfMonth: false,
        month: false,
        dayOfWeek: false,
    };

    for (let i = 0; i < FIELD_ORDER.length; i += 1) {
        const field = FIELD_ORDER[i]!;
        const token = tokens[i]!;
        const { set, isStar } = expandField(field, token);
        values[field] = set;
        restricted[field] = !isStar;
    }

    return {
        minute: values.minute,
        hour: values.hour,
        dayOfMonth: values.dayOfMonth,
        month: values.month,
        dayOfWeek: values.dayOfWeek,
        dayOfMonthRestricted: restricted.dayOfMonth,
        dayOfWeekRestricted: restricted.dayOfWeek,
        raw: trimmed,
    };
}

function expandField(
    field: FieldName,
    token: string,
): { set: Set<number>; isStar: boolean } {
    const [min, max] = FIELD_RANGES[field];
    const parts = token.split(',');
    const result = new Set<number>();
    let isStar = true;

    for (const part of parts) {
        if (part.length === 0) {
            throw new Error(`Empty term in ${field}: "${token}"`);
        }
        let rangeExpr = part;
        let step = 1;

        if (part.includes('/')) {
            const [rangePart, stepPart, ...rest] = part.split('/');
            if (rest.length > 0 || !rangePart || !stepPart) {
                throw new Error(`Malformed step in ${field}: "${part}"`);
            }
            step = Number.parseInt(stepPart, 10);
            if (!Number.isInteger(step) || step <= 0) {
                throw new Error(`Invalid step in ${field}: "${part}"`);
            }
            rangeExpr = rangePart;
        }

        if (rangeExpr !== '*' && rangeExpr !== '') {
            isStar = false;
        }

        let lo: number;
        let hi: number;
        if (rangeExpr === '*') {
            lo = min;
            hi = max;
        } else if (rangeExpr.includes('-')) {
            const [loStr, hiStr, ...rest] = rangeExpr.split('-');
            if (rest.length > 0 || !loStr || !hiStr) {
                throw new Error(`Malformed range in ${field}: "${part}"`);
            }
            lo = parseIntegerOrThrow(field, loStr);
            hi = parseIntegerOrThrow(field, hiStr);
        } else {
            lo = parseIntegerOrThrow(field, rangeExpr);
            hi = lo;
            // A bare literal means "just this one value" — not a wildcard.
            isStar = false;
        }

        assertInRange(field, lo, min, max);
        assertInRange(field, hi, min, max);
        if (lo > hi) {
            throw new Error(`Inverted range in ${field}: "${part}"`);
        }

        for (let v = lo; v <= hi; v += step) {
            result.add(v);
        }
    }

    if (result.size === 0) {
        throw new Error(`No values matched for ${field}: "${token}"`);
    }
    return { set: result, isStar };
}

function parseIntegerOrThrow(field: FieldName, raw: string): number {
    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n) || !/^-?\d+$/.test(raw)) {
        throw new Error(`Invalid integer in ${field}: "${raw}"`);
    }
    return n;
}

function assertInRange(
    field: FieldName,
    value: number,
    min: number,
    max: number,
): void {
    if (value < min || value > max) {
        throw new Error(
            `Value ${value} out of range for ${field} [${min}-${max}]`,
        );
    }
}

// Advance by one minute at a time looking for a match. Bounded by 4 years —
// the only way to exceed that is a never-satisfiable combination (e.g. Feb 30)
// or a DST pathological case, both of which should surface as errors.
const MAX_ITERATIONS = 4 * 366 * 24 * 60;

export function nextFireAt(cron: CronExpression, from: Date): Date {
    if (Number.isNaN(from.getTime())) {
        throw new Error('`from` is not a valid Date');
    }
    const start = new Date(from.getTime());
    start.setSeconds(0, 0);
    // Strictly after `from`, even when `from` lands exactly on a minute boundary.
    let candidate = new Date(start.getTime() + 60_000);

    for (let i = 0; i < MAX_ITERATIONS; i += 1) {
        if (matches(cron, candidate)) {
            return candidate;
        }
        candidate = new Date(candidate.getTime() + 60_000);
    }
    throw new Error(
        `nextFireAt: no match within 4 years for cron "${cron.raw}"`,
    );
}

function matches(cron: CronExpression, d: Date): boolean {
    if (!cron.minute.has(d.getMinutes())) return false;
    if (!cron.hour.has(d.getHours())) return false;
    if (!cron.month.has(d.getMonth() + 1)) return false;

    const domMatch = cron.dayOfMonth.has(d.getDate());
    const dowMatch = cron.dayOfWeek.has(d.getDay());

    if (cron.dayOfMonthRestricted && cron.dayOfWeekRestricted) {
        // Standard cron semantics: if both fields are restricted, OR them.
        return domMatch || dowMatch;
    }
    return domMatch && dowMatch;
}
