// P15a/P15b — NormalizedUsage type contract.
//
// Lives in the shared layer so application and telemetry code can depend on
// the shape without reaching into infra. Provider-specific normalizers (which
// know the raw payload shapes) live in src/infra/llm/usage/ and import this
// type.

export interface NormalizedUsage {
    /** Provider name (e.g. 'openai', 'anthropic', 'codex', 'minimax'). */
    readonly provider: string;
    /** Model name as reported / used. */
    readonly model: string;
    /** Regular prompt (input) tokens billed at the full input rate. */
    readonly input: number;
    /** Completion / output tokens. */
    readonly output: number;
    /** Prompt tokens served from cache. */
    readonly cacheRead?: number;
    /** Prompt tokens written into cache (Anthropic-style). */
    readonly cacheCreate?: number;
    /** Prompt tokens deleted from cache (Anthropic-style). */
    readonly cacheDelete?: number;
    /** Reasoning / thinking tokens (Codex, some OpenAI models). */
    readonly reasoning?: number;
    /** Best-effort cost in USD. Undefined when unknown. */
    readonly costUsd?: number;
}
