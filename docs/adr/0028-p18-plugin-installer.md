# ADR 0028 — P18 Plugin Installer + Loader

Status: Accepted
Date: 2026-05-11
Phase: P18

## Context

Phase 18 of the OpenClaude parity roadmap requires a plugin system that can
install / uninstall / enable / disable third-party plugins and expose the four
extension points OpenClaude’s users expect from a `xqoder.plugin.json`:

- slash commands
- tools
- skills
- lifecycle hooks

P17 shipped the core-skills loader (`loadSkillsDir`) and left a follow-up to
reuse it for plugin-bundled skill bundles. P18 picks that up and adds the
installer surface plus a registration-based loader whose side-effects are
fully reversible for `/reload-plugins`.

The existing `src/plugins/*` layer already handles
`@xqoder/plugin-sdk`–style **built-in command plugins** and workspace path
discovery. It does **not** deal with disk-level `~/.xqoder/plugins/<name>/`
layouts, manifest parsing, or lifecycle rollback — so P18 lives in a new
location (`src/infra/plugins/`) rather than mutating the SDK-facing plugin
bus.

## Decision

### Layer

- New module at `src/infra/plugins/` (matches the infra convention used for
  `plugin-sdk`, `permissions`, `storage`, etc.).
- Exposed through the existing `@xqoder/plugin-sdk` does **not** change — the
  SDK still owns the `PluginAPI` used by built-in command plugins.
- The disk-level installer/loader is consumed directly via relative
  `../../infra/plugins/index.js` from `src/commands/system/plugins.ts`.

### Manifest

- `parsePluginManifest(input)` returns a tagged result `{ ok, manifest } |
  { ok: false, errors }` — CLI surfaces errors via stderr; loader throws.
- Narrowing via `parsed.ok !== true` instead of `!parsed.ok` to accommodate
  `tsc --declaration` emit under `strict: false` (discriminated-union
  narrowing was lost when only `ok: true` was declared).
- Hook event names are validated against `SUPPORTED_HOOK_EVENTS` from
  `@xqoder/shared` so a typo in `xqoder.plugin.json` fails loudly at install
  time, not silently at hook dispatch time.
- Skills accept either `file` (single markdown) or `dir` (scan a directory).
  At least one must be present.

### Installer

- `installLocalPlugin(sourceDir, { force })` copies a directory into
  `~/.xqoder/plugins/<name>/`. No npm/tarball wrapper in v1 — users run
  `npm install --prefix …` themselves and point the installer at the
  resulting directory. Rationale: keeps P18 dependency-free and lets us ship
  the npm adapter later without locking in a package manager choice.
- `XQODER_PLUGINS_HOME` env var overrides the home path (used by tests; also
  useful for CI).
- `removeInstalledPlugin(name)` refuses to remove a plugin that isn’t
  installed rather than silently succeeding — symmetry with `install`.
- `listInstalledPlugins()` tolerates corrupt manifests: returns the valid
  subset so a single broken plugin can’t prevent `xqoder plugin list` from
  surfacing the others. Surfacing the corruption to the user is deferred to
  a follow-up (verbose flag).

### Loader (reversible registration)

- `loadExtendedPlugin(dir, registries): { manifest, dir, unload }` — the
  registries are an **adapter**, not a concrete class, so the loader stays
  pure and testable without booting the full runtime.
- Registration collects a `rollback` stack; `unload()` runs them in reverse
  order then awaits `entry.onDeactivate(ctx)`. A failure inside one
  rollback step never aborts the others — we prefer best-effort cleanup
  over leaving partially-registered state on disk.
- `onActivate` runs **after** all synchronous registrations succeed; if it
  throws, the loader unwinds the rollback stack before re-raising, so a
  failed activation leaves the registries identical to the pre-load state.
- **Skill reuse (ADR 0027 follow-up)**: both `file` and `dir` skill
  provisions call `loadSkillsDir(...)`. For `file`, the parent dir is
  scanned and filtered to the exact path, which intentionally costs a
  directory read but guarantees identical frontmatter parsing and name
  derivation semantics with project-local / user-level search roots.

### State (enable/disable)

- `~/.xqoder/plugins/state.json` stores a `disabled[]` list — a plugin is
  enabled unless listed. Chosen over a per-plugin `.enabled` marker file so
  `xqoder plugin disable --all` stays a one-line write and `enable` can
  idempotently remove duplicates.
- Corrupt state falls back to `{ disabled: [] }` and the next write repairs
  the file. A broken `state.json` can never lock the user out of their own
  plugins.

### CLI

- Extend the existing `xqoder plugin` group:
  - `list` (unchanged contract; now also lists installed third-party
    plugins alongside built-in discovery).
  - `install <source>` / `remove <name>` (alias `uninstall`).
  - `enable <name>` / `disable <name>`.
  - `home` — prints the install root (for shell integrations and debug).
- CLI wraps errors from the installer: surfaces the message via stderr and
  sets `process.exitCode = 1` rather than letting a thrown error crash the
  process with an unhelpful stack trace.

## Out of scope for P18

- **npm / tarball installer**. The manifest parser already accepts the
  target shape, so a future `installNpmPlugin(pkg)` is additive.
- **fs.watch hot reload**. The施工单 lists it; in practice Ctrl+R /
  `/reload-plugins` covers the use case without needing a live filesystem
  watcher. Adding `fs.watch` now would pin us to a debouncing policy we
  don’t yet have data to choose.
- **Process-level sandbox**. Explicitly deferred by the施工单 (“v1 不做”).
  Guardrails today are: the `onActivate` try/catch, plus
  `XQODER_DISABLE_THIRD_PARTY_PLUGINS` is **not** implemented yet — the
  current escape hatch is `xqoder plugin disable --all` (looped) or
  deleting the directory.
- **Wiring the loader into the runtime lifecycle**. P18 ships the
  installer CLI and the reusable loader. Having the runtime actually call
  `loadExtendedPlugin(...)` at boot and rewire `/reload-plugins` is left to
  a follow-up — it requires choosing registry adapters at the runtime
  level (ToolRegistry, SlashCommandRegistry, HookRegistry, SkillRegistry),
  which would bloat this phase and intersect with P24 session persistence.

## Consequences

### Positive

- Users can start hand-authoring plugins today:
  `mkdir ~/.xqoder/plugins/my-plugin && echo '{...}' > xqoder.plugin.json`
  and `xqoder plugin list` picks it up.
- Manifest parser + loader are usable without importing the runtime — unit
  tests stay fast (141 ms for the 26-test infra suite).
- Reusing `loadSkillsDir` means plugin-bundled skills honour the same
  `SKILL.md` / flat-markdown conventions that project skills do. No
  divergence to maintain.
- CLI shape matches OpenClaude (`install / remove / enable / disable /
  list`) so existing plugin docs translate 1:1.

### Negative / risks

- The installer is a trust boundary we don’t yet enforce. v1 plugins run
  in-process, so `installLocalPlugin` is effectively “copy arbitrary code
  into a path the runtime will `import()` later.” Acceptable for v1 (local
  directories only; user is installing their own code) but must tighten
  before we add an npm adapter.
- `loadExtendedPlugin` ties loading order to manifest order. If a plugin’s
  tool depends on another plugin’s skill being present at activation time,
  ordering is not yet guaranteed. P18 does not address this — single
  plugins self-contained.

## Alternatives considered

- **Put the loader inside `src/plugins/*`** next to the existing
  command-plugin bus. Rejected: that module’s vocabulary
  (`PluginAPI.registerCommand(...)`) was designed around the SDK’s typed
  registrations; bending it to also accept `commands: [{name, file}]`
  manifest-driven registrations would have widened the SDK surface for no
  external gain.
- **Use zod for manifest validation**. Rejected: zod would be our first
  manifest-layer dependency for ~150 lines of validation — the handwritten
  validator is as small and gives the same structured error list.
- **Store enable/disable as file names** (e.g. `plugin.disabled`).
  Rejected: every enable/disable would require a rename, and listing
  state would require stat-ing every plugin dir.

## Follow-ups

1. Wire `loadExtendedPlugin(...)` into runtime boot. This needs concrete
   adapters against `ToolRegistry`, the slash-command registry, and the
   hook-handler settings store (and a decision on whether plugin hooks
   merge into `HooksSettings` or become a separate event stream).
2. Surface corrupt manifests from `listInstalledPlugins()` under a
   `--verbose` flag so users can see why a plugin directory was silently
   skipped.
3. Add an npm-package installer that downloads, extracts, and then
   delegates to `installLocalPlugin(...)`.
4. `XQODER_DISABLE_THIRD_PARTY_PLUGINS=1` kill switch — cheap once the
   runtime wiring lands, because it becomes “skip `loadExtendedPlugin`
   for everything under `listInstalledPlugins()`”.
