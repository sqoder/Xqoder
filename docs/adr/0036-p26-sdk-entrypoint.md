# ADR 0036 — P26 SDK entrypoint (headless / structuredIO)

- **Status:** Accepted
- **Date:** 2026-05-12
- **Phase:** P26 (S6 · SDK entrypoint)
- **Preceding ADR:** ADR 0035 (P25 Bridge / Remote / Daemon)
- **Supersedes:** —

## Context

The 施工单 `phase-26-sdk-entrypoint.md` specifies four output modes:

- **A** `xqoder -p "…"` — plain text.
- **B** `xqoder -p "…" --output-format=json` — single JSON result.
- **C** `xqoder -p "…" --output-format=ndjson` — ndjson event stream.
- **D** `xqoder --input-format=ndjson --output-format=ndjson` — full-duplex.

Plus a programmatic `run(opts): AsyncIterable<SdkEvent>` API.

Modes A and B were already working. This phase adds C, D, and the SDK API.

## Decision

### 1. `src/cli/structured-io.ts`

Five exports:

- `ndjsonSafeStringify(obj)` — circular-safe JSON serializer that escapes
  embedded newlines and appends `\n`. No third-party deps.
- `isControlMessage(obj)` — type guard for `{ type: "control.*" }` objects.
- `readNdjsonStdin(input?)` — async generator that reads JSON lines from
  stdin, yields `NdjsonInputMessage` (user or control). Skips malformed
  lines silently.
- `emitEnvelope(envelope, format, out?)` — writes one ndjson line for
  `ndjson` / `stream-json` formats; no-op for `text` / `json`.
- `emitFinalResult(result, format, out?)` — writes `{ type: "done", ... }`.

### 2. `OutputFormat` extended to include `'ndjson'`

`src/infra/shared/format.ts`: `OutputFormat` now includes `'ndjson'`.
`formatOutput` treats `ndjson` the same as `json` for the final response
(the streaming events are handled by `emitEnvelope`).

`resolveRootShellOutputFormat` accepts `'ndjson'` and the error message
lists all four valid formats.

### 3. `--input-format ndjson` + `--output-format ndjson` (mode D)

`src/cli/root-shell.ts`:

- New `inputFormat?: string` field on `RootShellOptions`.
- New `ndjsonReader?` injectable on `RootShellDependencies` (for testing).
- When `inputFormat === 'ndjson'`, `runRootShellAction` reads messages from
  `readNdjsonStdin()` (or the injected reader) and calls `promptRunner` for
  each user message. `control.interrupt` breaks the loop.
- `--input-format ndjson` option added to `applyRootShellOptions`.

### 4. `src/entrypoints/sdk.ts` — programmatic API

```ts
export async function* run(opts: RunOptions): AsyncGenerator<SdkEvent, RunResult>
```

Wraps `runChatMessageStream` in an async generator. Events are buffered in
an array; a `resolveNext` callback wakes the generator when new events
arrive. The generator drains the buffer, then awaits the stream promise for
the final result.

`RunOptions`: `prompt`, `cwd`, `model`, `agent`, `sessionId`, `newSession`,
`maxTurns`, `signal`, `noSessionPersistence`.

### 5. Tests

- `test/cli/structured-io.test.ts` — 17 tests covering all five exports.
- `test/cli-root-and-tui.test.ts` — 3 new tests:
  - `resolveRootShellOutputFormat` accepts `ndjson` and `stream-json`.
  - ndjson input mode via injectable reader.
  - `control.interrupt` stops the loop.

## Consequences

### Positive

- Mode D (full-duplex ndjson) is now available for CI / scripting use cases.
- SDK `run()` provides a clean programmatic API without spawning a subprocess.
- `ndjsonSafeStringify` is safe for circular objects and embedded newlines.
- Coverage gate passes (root-shell.ts line coverage restored above 60%).
- 1685 pass / 0 fail.

### Negative / accepted

- SDK `run()` uses a simple event buffer + callback pattern rather than a
  proper backpressure queue. For very high-throughput streams this could
  buffer many events. The 施工单 §4 `SdkEventQueue` with high-water-mark
  is deferred to a follow-up.
- `ndjson` and `stream-json` are treated identically in the current
  implementation. A future cleanup could unify them under one name.

## Alternatives considered

1. **Use `stream.Transform` for the SDK generator** — rejected: adds
   complexity; the buffer+callback pattern is simpler and correct for the
   expected event rates.
2. **Separate `xqoder sdk` subcommand** — rejected: the 施工单 uses
   `--input-format` / `--output-format` flags on the root command.

## Follow-ups

- P27: 40+ tools complete catalog.
- Later: `SdkEventQueue` with high-water-mark backpressure.
- Later: `@xqoder/sdk` npm package with proper `sdk.d.ts`.

## Validation

- `bun test test/cli/structured-io.test.ts` — 17 tests pass.
- `bun test test/cli-root-and-tui.test.ts` — 8 tests pass (3 new).
- `bun run release:check` — 1685 pass / 0 fail, coverage PASS.
