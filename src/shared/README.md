# `src/shared`

This directory owns small, stable cross-cutting modules.

Put here:

- errors
- logging
- schemas
- shared types
- generic utilities

Do not put here:

- feature-specific business logic
- hidden service locators
- transport adapters

Allowed imports:

- none of the app-specific layers
