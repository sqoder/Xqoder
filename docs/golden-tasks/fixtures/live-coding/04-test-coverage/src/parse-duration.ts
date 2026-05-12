export function parseDuration(input: string): number {
    const trimmed = input.trim();
    const match = trimmed.match(/^(\d+)(ms|s|m|h)$/);
    if (!match) {
        throw new Error(`invalid duration: ${input}`);
    }
    const amount = Number(match[1]);
    const unit = match[2] as 'ms' | 's' | 'm' | 'h';
    const multiplier: Record<typeof unit, number> = {
        ms: 1,
        s: 1000,
        m: 60_000,
        h: 3_600_000,
    };
    return amount * multiplier[unit];
}
