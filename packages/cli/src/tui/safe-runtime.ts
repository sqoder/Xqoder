interface WarningHost {
    emitWarning: typeof process.emitWarning;
}

export function isIgnorableTuiWarning(warning: unknown, type?: string): boolean {
    const warningType = type ?? (warning instanceof Error ? warning.name : undefined);
    const message = warning instanceof Error
        ? `${warning.name}: ${warning.message}`
        : String(warning);

    return warningType === 'ExperimentalWarning'
        && message.toLowerCase().includes('sqlite');
}

export function installSafeRuntimeGuards(host: WarningHost = process): () => void {
    const originalEmitWarning = host.emitWarning.bind(host);

    host.emitWarning = ((warning: Parameters<typeof process.emitWarning>[0], ...rest: unknown[]) => {
        const warningType = typeof rest[0] === 'string' ? rest[0] : undefined;
        if (isIgnorableTuiWarning(warning, warningType)) {
            return;
        }

        return originalEmitWarning(
            warning as never,
            ...(rest as Parameters<typeof process.emitWarning> extends [unknown, ...infer Tail] ? Tail : never[]),
        );
    }) as typeof process.emitWarning;

    return () => {
        host.emitWarning = originalEmitWarning as typeof process.emitWarning;
    };
}
