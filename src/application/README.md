# `src/application`

This directory owns use cases and orchestration.

Put here:

- reusable product actions
- workflow coordination
- application services
- cross-domain permission checks

Do not put here:

- CLI or TUI parsing
- HTTP transport code
- direct provider or storage implementations

Allowed imports:

- `domain`
- `shared`
- port interfaces
