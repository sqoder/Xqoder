export interface ElicitationRequest {
    readonly title?: string;
    readonly schema: {
        readonly fields: ReadonlyArray<{
            readonly key: string;
            readonly type: 'string' | 'number' | 'boolean';
            readonly required?: boolean;
        }>;
    };
}

export interface ElicitationResponse {
    readonly action: 'accept' | 'cancel';
    readonly data?: Readonly<Record<string, string | number | boolean>>;
}

export type ElicitationAsk = (
    request: ElicitationRequest,
) => Promise<ElicitationResponse | null>;

const CANCEL: ElicitationResponse = { action: 'cancel' };

export async function handleElicitation(
    request: ElicitationRequest,
    ask: ElicitationAsk | undefined,
    options: { timeoutMs?: number } = {},
): Promise<ElicitationResponse> {
    if (!ask) {
        return CANCEL;
    }

    const timeoutMs = options.timeoutMs ?? 120_000;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<ElicitationResponse>((resolve) => {
        timer = setTimeout(() => resolve(CANCEL), timeoutMs);
    });

    try {
        const raced = await Promise.race([
            ask(request).then((answer) => {
                if (!answer) {
                    return CANCEL;
                }
                if (answer.action !== 'accept') {
                    return CANCEL;
                }
                const data = answer.data ?? {};
                for (const field of request.schema.fields) {
                    if (field.required && !(field.key in data)) {
                        return CANCEL;
                    }
                }
                return { action: 'accept', data } satisfies ElicitationResponse;
            }),
            timeoutPromise,
        ]);
        return raced;
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}
