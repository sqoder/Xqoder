# 04 — Add regression test

`src/clamp-percentage.ts` has an uncovered edge case: `NaN`. The current
implementation returns `NaN` unchanged because neither comparison
(`value < 0`, `value > 100`) is true for `NaN`. There is no test asserting
what should happen in that case.

## Task (TDD loop)

1. Add a new regression test to `test/clamp-percentage.test.ts` that
   asserts the behaviour for `NaN` — the expected result is `0`. Run
   `bun test test/clamp-percentage.test.ts` and confirm the new test
   fails while the existing three tests still pass.
2. Change the implementation in `src/clamp-percentage.ts` with the
   smallest possible edit so the regression test passes. A
   `Number.isNaN` guard at the top is the cleanest fix.
3. Re-run the targeted test and confirm all four tests pass.
4. In the final summary mention the new `regression` `test`, the
   implementation file that changed, and that the tests now `pass`
   (extra coverage for the NaN case is acceptable to call out).
