# 01 — Small bug fix loop

A self-contained fixture with one failing test and one small logic bug.

## What's broken

`src/sum-positive.ts` exports `sumPositive(numbers: number[]): number`. The
intent is to sum only the strictly positive entries and skip negatives and
zero. The current implementation sums every entry without filtering, so the
accompanying test fails on any input that contains a negative number.

## Task

1. Run `bun test test/sum-positive.test.ts` from this directory. You should
   see the test fail.
2. Make the smallest change to `src/sum-positive.ts` so the test turns green
   — filter out entries that are not strictly positive.
3. Re-run the targeted test and confirm it passes.
4. Summarize the changed file and the verification result. Mention
   "changed", "test", and one of "pass" / "passed" / "green".
