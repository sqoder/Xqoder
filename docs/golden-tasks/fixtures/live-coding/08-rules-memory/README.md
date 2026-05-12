# 08-rules-memory — Rules and memory loading

Scenario: the fixture contains a `CLAUDE.md` **rule** ("always prefer
absolute imports"), a `.xqoder/notepad.md` working-memory entry
("current task: audit imports in `src/`"), and a trivial `src/foo.ts`
that uses a relative import. The task asks which **rule** / **memory**
entry governed the decision.

Expected agent flow:

1. Read `CLAUDE.md`, `.xqoder/notepad.md`, `src/foo.ts`.
2. Apply the absolute-import rule.
3. Final response mentions the **rule** + **memory** loading and cites
   **CLAUDE.md** or **.xqoder** or **notepad**. Matches
   `expectedAll: [rule, memory]` +
   `expectedAny: [CLAUDE.md, .xqoder, notepad]`.
