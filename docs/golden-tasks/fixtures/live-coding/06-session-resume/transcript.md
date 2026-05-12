# Previous session transcript (fixture)

## Turn 1 — user

> Please add a small math helper module. I need `add(a, b)`,
> `subtract(a, b)`, and `divide(a, b)` in `src/math.ts`, with matching
> tests in `test/math.test.ts`.

## Turn 2 — assistant

Created `src/math.ts` with `add` and `subtract`. Added the corresponding
tests and they pass.

For `divide`, I want to confirm the intended behaviour when `b === 0`.
Two reasonable options:

- Return `Infinity` / `-Infinity` (native JS semantics).
- Throw a `RangeError("divide by zero")`.

## Turn 3 — user

> Throw. We don't want silent `Infinity` values leaking into the rest of
> the system — better to fail loudly at the call site.

## Turn 4 — assistant

Got it — I'll throw `RangeError('divide by zero')` when `b === 0`. I'll
add the `divide` function and its tests next.

[session ended before Turn 5 — divide was never written]
