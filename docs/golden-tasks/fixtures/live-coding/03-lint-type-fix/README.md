# 03 — Lint and type repair

`src/normalize-order.ts` fails `bunx tsc --noEmit` because it assigns
`input.currency` (optional, `string | undefined`) into a local whose type is
`string`. Fix it with the smallest possible change.

## Task

1. Run `bunx tsc --noEmit -p tsconfig.json`. You'll see a type error on the
   `currency` assignment.
2. Apply the smallest fix — default the optional to `'USD'`, or narrow the
   type at the assignment, whichever reads cleaner. Do not widen strictness
   settings and do not cast with `as`.
3. Re-run the targeted typecheck and confirm zero errors.
4. Summarize the `type` issue, how you `fix`ed it, and mention that the
   typecheck now passes.
