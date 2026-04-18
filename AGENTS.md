# Xqoder team snapshot instructions

This `AGENTS.md` applies to this repository snapshot and all descendants.

- This repository is a local snapshot of `/Users/wangxinglin/Desktop/ts/Xqoder` created to run `omx team` safely.
- Keep changes tightly scoped to the assigned files and task.
- Do not revert unrelated work or rewrite unrelated files just to make local diffs cleaner.
- Treat `.omx/`, `dist/`, `coverage/`, runtime logs, and generated team state as runtime artifacts unless the task explicitly targets them.
- Prefer surgical refactors that preserve behavior.
- Verify touched slices with the smallest relevant checks first, then broader checks when needed.
- Follow user, system, and developer instructions from the active thread; more specific instructions override this file.
