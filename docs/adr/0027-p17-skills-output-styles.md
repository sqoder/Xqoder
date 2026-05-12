# ADR 0027 — P17 Skills + Output Styles

**Status:** Accepted
**Date:** 2026-05-11
**Phase:** P17

## Context

Phase 17 adds two user-visible authoring surfaces to XQoder:

1. **Skills** — markdown playbooks with frontmatter (`name`, `description`,
   `triggers`, `tools`) scanned from project + user directories. The model
   can query available skills, pick one, and receive the full body back
   as tool output.
2. **Output styles** — markdown files with `systemPromptAppend` +
   `responseFormat` frontmatter. A project selects one at a time and the
   chat pipeline appends it to the system prompt as a dynamic tail.

The施工单 (`docs/openclaude-parity/phase-17-skills-and-output-styles.md`)
specifies these behaviours and a CLI surface (`xqoder skills ls/info`,
`xqoder output-style ls/use`).

Two soft red-line files are touched:

- `src/application/chat/turn-intake.ts` — add `applyOutputStyleTail`
  around the existing `joinPromptAppendices` call so the style text is
  appended *after* the project prefix, preserving the prompt-cache prefix.
- `src/core/agent/tools/interaction-tools.ts` — extend `SkillTool` with an
  `action: "list" | "activate"` parameter (activate is default, legacy
  `{name}` / `{filePath}` calls still work unchanged).

No hard red-line file is modified.

## Decision

### Skills

- Core module layer lives under `src/core/skills/`:
  - `frontmatter.ts` — minimal YAML-subset parser (scalar, quoted scalar,
    inline `[a,b,c]`, block list). No third-party dependency.
  - `load-dir.ts` — scans `<root>/<name>.md` and `<root>/<name>/SKILL.md`;
    deduplicates by name across roots (first root wins).
  - `registry.ts` — `loadSkillRegistry(projectRoot)` returns a stable
    in-memory registry with project and user roots (respects
    `process.env.HOME` so tests can isolate).
  - `activator.ts` — `detectSkillCandidates(prompt, registry, { topN })`
    ranks via name hit (+5) → trigger hit (+3) → description-word hit (+1).
    Returns matched triggers for explainability.
- `SkillTool` gains two modes:
  - `action: 'activate'` (default) — returns skill body and surfaces
    `metadata.activatedSkill` + `metadata.allowedTools`.
  - `action: 'list'` — returns a human summary and
    `metadata.skillCount` / `metadata.ranked`. If a `prompt` parameter is
    supplied, the list is re-ranked.
- `allowedTools` on the metadata is **advisory only** in P17: we do not
  yet reach into `permission-gate` to widen the per-turn whitelist. That
  wiring is deferred to P12/P21 follow-up work where the permission gate
  is already being revised, because hot-patching tool visibility mid-turn
  requires coordination with in-flight approval state.
- CLI: `xqoder skills ls [--json]` and `xqoder skills info <name>
  [--json]`. `skills install <repo>` is out-of-scope for P17 and will land
  with the plugin-install work in P18.

### Output styles

- Core module layer under `src/core/output-styles/`:
  - `load-dir.ts` — parses markdown frontmatter;
    `systemPromptAppend` wins over body text when both are present.
  - `registry.ts` — parallel to skills registry.
  - `inject.ts::appendOutputStyleTail(prompt, style)` — pure function
    producing `<prompt>\n\n[OutputStyle=<name>]\n<append>`.
  - `selection.ts` — reads/writes
    `.xqoder/state/output-style.json` (`{ name }`). Chosen over session
    metadata so selection survives across sessions without depending on
    P24 session persistence.
  - `resolve-active.ts` — returns the currently active `OutputStyleFile`
    or `undefined`. Silent on errors; a broken config never blocks a turn.
- `turn-intake.ts::applyOutputStyleTail` wraps the existing join so the
  style append is a dynamic tail (cache-prefix safe) applied after the
  project prefix, instruction appendix, and memory appendix.
- CLI: `xqoder output-style ls [--json]`, `use <name>`, `show [--json]`,
  `clear`. Active style is marked with `*` in the plain-text listing.

### Naming + marker

`[OutputStyle=<name>]` is the marker at the head of the tail. This is
both visible to the model (so it can self-correct if it drifts) and
machine-detectable for any future cache-rebuild tooling that needs to
strip it.

## Consequences

- Skills can be authored in `.xqoder/skills/`, `.claude/skills/`, or the
  user-level equivalents, matching the Claude Code convention already
  used by `skill-paths.ts`.
- Existing callers of `SkillTool` that pass only `{name}` or `{filePath}`
  continue to work; no migration required.
- Output-style selection is per-project. There is no session-level
  override yet. A user that wants per-session overrides can clear the
  selection, run, then restore — explicit and reversible.
- `allowedTools` metadata is visible but not yet enforced. Surface area
  is the same as a `read_file` call today; no new attack surface.

## Tests

- `test/core/skills/frontmatter.test.ts` — 5 cases (scalar, block list,
  inline array, quote stripping, no frontmatter).
- `test/core/skills/load-dir.test.ts` — 5 cases (flat / subdir / reject
  no description / missing dir / dedup across roots).
- `test/core/skills/activator.test.ts` — 6 cases (empty / trigger priority
  / name match / case-insensitive / topN / matched triggers).
- `test/core/skills/registry.test.ts` — 3 cases (root order / extraRoots
  / load + get).
- `test/core/output-styles/load-dir.test.ts` — 4 cases (frontmatter body
  fallback / explicit override / rejection / invalid responseFormat).
- `test/core/output-styles/inject.test.ts` — 4 cases (undefined / append
  / marker / empty-append).
- `test/core/output-styles/selection.test.ts` — 4 cases (write+read /
  missing / clear / malformed).
- `test/core/agent/skill-tool-p17.test.ts` — 5 cases for the tool.
- `test/application/chat/output-style-inject.test.ts` — 3 cases for the
  turn-intake wiring (selected / unset / missing style).
- `test/commands/skills-output-style-cli.test.ts` — 6 cases for the CLI
  surface.

45 new tests total.

## Alternatives considered

- **Session-metadata selection.** Rejected — that ties output-style to
  P24's session persistence work. File-backed state is one file and one
  key; trivial to migrate later if we decide to move it.
- **Static system-prompt append.** Rejected — embedding the style text
  into the static prompt prefix would invalidate the Anthropic prompt
  cache every time the user toggles styles. Dynamic tail costs a few
  hundred tokens per turn and avoids cache churn.
- **Full permission-gate integration for `allowedTools`.** Rejected —
  mid-turn permission mutation needs coordination with approval state
  currently owned by a soft red-line file. Advisory metadata lets the
  model and UI surface the intent without touching the approval
  pipeline in this phase.

## Follow-ups

- P18 plugin installer should re-use `loadSkillsDir` when plugin
  manifests ship skill bundles.
- P12/P21 follow-up: promote `metadata.allowedTools` into a real
  permission-gate widening with approval UX for newly-unlocked tools.
- Bundled skills (`src/core/skills/bundled/`) directory left empty;
  populate with summaries referencing upstream documentation once the
  curated list is finalized.
