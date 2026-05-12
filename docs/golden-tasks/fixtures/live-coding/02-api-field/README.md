# 02 — API field extension

Add a new `displayName` field to the user response shape. The existing
consumers must still see `id` and `email`, so the change must be additive.

## What's needed

`src/user-response.ts` currently returns `{ id, email }`. A new test in
`test/user-response.test.ts` expects `response.displayName` to be the user's
first name joined with the last name when present, or just the first name
when `lastName` is absent.

## Task

1. Run `bun test test/user-response.test.ts`. It should fail: `displayName`
   is undefined.
2. Extend the `UserResponse` interface and `buildUserResponse` to populate
   `displayName` from `firstName` and optional `lastName`, trimmed.
3. Re-run the test and confirm it passes.
4. Summarize: mention the new `field`, the updated `test`, and call out
   backward compatibility — the old `id` and `email` fields are still
   present so existing consumers keep working.
