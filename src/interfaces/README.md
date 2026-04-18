# `src/interfaces`

This directory owns transport and presentation adapters.

Put here:

- CLI command parsing
- TUI controllers and presenters
- HTTP routes and handlers

Do not put here:

- reusable workflows
- storage logic
- model-provider integration
- business rules

Allowed imports:

- `application`
- `shared`
