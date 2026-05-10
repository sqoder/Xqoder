// Normalizes a JSON Schema to what OpenAI-compatible providers expect for
// function calling. In strict mode we force every property with a default
// value *in the schema's required list* to be listed there; optional props
// stay off `required`. `additionalProperties: false` is always applied so
// models don't invent extra keys.

export type JsonSchemaRecord = {
    type?: string;
    properties?: Record<string, JsonSchemaRecord>;
    required?: string[];
    items?: JsonSchemaRecord;
    additionalProperties?: boolean | JsonSchemaRecord;
    enum?: unknown[];
    // everything else is preserved verbatim
    [key: string]: unknown;
};

export interface SanitizeOptions {
    readonly strict?: boolean;
}

export function normalizeSchemaForOpenAI(
    input: JsonSchemaRecord,
    options: SanitizeOptions = {},
): JsonSchemaRecord {
    return normalize(input, options, 0);
}

const MAX_DEPTH = 16;

function normalize(
    schema: JsonSchemaRecord,
    options: SanitizeOptions,
    depth: number,
): JsonSchemaRecord {
    if (depth > MAX_DEPTH) {
        throw new Error(`normalizeSchemaForOpenAI: schema too deep (>${MAX_DEPTH})`);
    }

    const next: JsonSchemaRecord = { ...schema };

    if (Array.isArray(next.enum)) {
        next.enum = next.enum.map((value) =>
            typeof value === 'string' ? value : JSON.stringify(value),
        );
    }

    if (next.type === 'array' && next.items && typeof next.items === 'object') {
        next.items = normalize(next.items, options, depth + 1);
    }

    if (next.type === 'object' || next.properties) {
        next.additionalProperties = false;
        const properties = next.properties ?? {};
        const normalizedProps: Record<string, JsonSchemaRecord> = {};
        for (const [key, value] of Object.entries(properties)) {
            normalizedProps[key] = value && typeof value === 'object'
                ? normalize(value, options, depth + 1)
                : value;
        }
        next.properties = normalizedProps;

        if (options.strict) {
            const declaredRequired = new Set(next.required ?? []);
            next.required = Object.keys(normalizedProps).filter((k) =>
                declaredRequired.has(k),
            );
        }
    }

    return next;
}
