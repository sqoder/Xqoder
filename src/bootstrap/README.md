# `src/bootstrap`

This directory is the composition root for XQoder.

Put here:

- program startup
- dependency wiring
- environment-specific assembly

Do not put here:

- reusable business logic
- UI rendering behavior
- provider-specific implementation details

Allowed imports:

- `interfaces`
- `application`
- `domain`
- `infrastructure`
- `shared`
