# 09 — Diff approval UI path

A small copy change to `src/greeting.ts` that must be routed through the
approval / diff-preview tool path rather than a silent overwrite.

## Setup

`src/greeting.ts` currently returns `'Hello, ' + name`. We want it to end
with a period and use a template literal: `` `Hello, ${name}.` ``.

## Task

1. Read `src/greeting.ts`.
2. Prepare the edit and surface it through the `edit_file` / `write_file`
   approval channel — the diff should be visible to the user for review.
3. Summarize: mention the `approval` request, the resulting `diff`-based
   verification, and one of `edit_file` / `write_file` / `preview`.
