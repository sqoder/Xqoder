# XQoder Architecture

> Target architecture for the next growth phase of XQoder
>
> Updated: 2026-04-17

## Summary

XQoder should evolve as a strong-boundary modular monolith.

The current repository already has useful product slices, but the top-level tree mixes four classification axes at the same time:

- delivery surface
- abstraction level
- technical adapter
- product capability

That makes it too easy for one feature to spread across `commands`, `core`, `features`, `platform`, and `services` at once.

The target state is simpler:

1. Top-level directories are organized by layer.
2. Each layer is organized by capability.
3. Cross-layer dependencies are one-way and enforced.
4. Existing code migrates incrementally instead of through a big-bang rewrite.

## Current Problems

These are the main architectural issues the new structure is designed to fix:

- `commands`, `platform`, and `services` all own parts of application behavior.
- `core`, `features`, and `services` overlap as business-logic homes.
- `infra` sometimes depends on higher-level implementations instead of ports.
- TUI and HTTP adapters have grown into orchestration layers.
- some policies are duplicated instead of being owned by one domain module.
- large files make responsibilities hard to isolate and test.

Examples from the current tree:

- `src/platform/tui` imports `src/commands/*` in places where it should call shared use cases instead.
- `src/infra/storage` depends on higher-level runtime and agent modules.
- `src/services/config-service.ts` mixes application logic with plugin discovery and CLI version access.
- `src/core/runtime/chat-runner.ts` is still a stub while outer entrypoints already treat it as a real runtime boundary.

## Target Shape

New work should converge on this structure:

```text
src/
  bootstrap/
    cli-main.ts
    tui-main.tsx
    http-main.ts
    compose.ts

  interfaces/
    cli/
    tui/
    http/

  application/
    chat/
    agent/
    sessions/
    memory/
    search/
    runtime/
    workflows/
    deploy/
    permissions/
    integrations/
    automation/

  domain/
    agent/
    conversation/
    session/
    memory/
    workspace/
    workflow/
    runtime/
    permissions/
    model-routing/
    budgeting/
    plugin-contracts/

  infrastructure/
    llm/
    storage/
    shell/
    lsp/
    mcp/
    search/
    deploy/
    remote-exec/
    plugins/
    notifications/

  shared/
    errors/
    logging/
    schema/
    types/
    utils/
```

## Layer Responsibilities

### `bootstrap`

Purpose:

- composition root
- program startup
- dependency wiring
- environment-specific assembly

Rules:

- may import every other layer
- must stay thin
- is the only place where concrete implementations should be composed together

### `interfaces`

Purpose:

- CLI argument parsing
- TUI event handling and rendering
- HTTP transport, routes, and response formatting

Rules:

- may import `application` and `shared`
- must not contain business rules
- must not instantiate infrastructure directly
- should convert transport input into application requests and application results into output

### `application`

Purpose:

- use cases
- orchestration
- workflow execution
- transaction boundaries
- permission checks across multiple domain objects

Rules:

- may import `domain`, `shared`, and port interfaces
- must not depend on CLI, TUI, or HTTP concerns
- should be the single entrypoint for reusable product actions

### `domain`

Purpose:

- core product rules
- entities and value objects
- state transitions
- permission and routing policies
- plugin contracts and tool definitions

Rules:

- may import `shared`
- must stay pure and framework-agnostic
- must not know about SQLite, shell, Commander, Ink, or HTTP

### `infrastructure`

Purpose:

- external systems and side effects
- persistence
- shell execution
- model providers
- LSP, MCP, search, deployment, notifications

Rules:

- may import `shared` and application or domain ports
- must not own product workflows
- must not depend on CLI or TUI adapters

### `shared`

Purpose:

- errors
- logging
- schemas
- reusable types
- cross-cutting utilities

Rules:

- should be small and stable
- must not become a hidden dumping ground for business logic

## Dependency Rules

Allowed dependency direction:

```text
bootstrap      -> interfaces, application, domain, infrastructure, shared
interfaces     -> application, shared
application    -> domain, shared
infrastructure -> application ports, domain contracts, shared
domain         -> shared
shared         -> no app-specific layers
```

Explicitly forbidden:

- `interfaces -> infrastructure`
- `interfaces -> interfaces`
- `application -> interfaces`
- `domain -> application`
- `domain -> infrastructure`
- `infrastructure -> interfaces`
- new business logic in `services/`
- new reusable business logic in `commands/` or `platform/`

## Capability Map

The architecture is designed to support future growth by making each capability land in one primary layer.

| Capability | Primary layer | Secondary layer |
| --- | --- | --- |
| new CLI commands | `interfaces` | `application` |
| new TUI panels | `interfaces` | `application` |
| new HTTP endpoints | `interfaces` | `application` |
| new model providers | `infrastructure` | `application` |
| model routing strategy | `domain` | `application` |
| new agent modes | `domain` | `application` |
| tool definitions | `domain` | `application`, `infrastructure` |
| tool execution adapters | `infrastructure` | `application` |
| session export/share flows | `application` | `infrastructure` |
| session replay/timeline | `application` | `domain`, `interfaces` |
| long-term memory | `application` | `domain`, `infrastructure` |
| code search and indexing | `infrastructure` | `application` |
| LSP features | `infrastructure` | `application` |
| MCP integrations | `infrastructure` | `application`, `domain` |
| automated fix/test loops | `application` | `domain`, `infrastructure` |
| deploy targets | `infrastructure` | `application`, `domain` |
| remote execution | `infrastructure` | `application`, `domain` |
| team collaboration | `domain` | `application`, `interfaces` |
| cost and budget controls | `domain` | `application`, `infrastructure` |
| plugin ecosystem | `infrastructure` | `domain`, `application` |

## Mapping From The Current Tree

This migration is intentionally incremental. Existing directories remain until their contents are moved.
They are compatibility-only holding areas, not valid landing zones for new reusable logic.

| Current area | Target landing zone |
| --- | --- |
| `src/cli` | `bootstrap` plus `interfaces/cli` |
| `src/commands` | `interfaces/cli` |
| `src/platform/tui` | `interfaces/tui` |
| `src/platform/server` | `interfaces/http` |
| `src/platform/terminal` | mostly `infrastructure/shell` |
| `src/services` | `application/*` |
| `src/core/agent` | `domain/agent`, `application/chat`, `infrastructure/*` |
| `src/core/runtime` | `application/chat`, `application/runtime`, `domain/runtime` |
| `src/core/workflow` | `domain/workflow`, `application/workflows` |
| `src/features/runtime` | `application/runtime`, `infrastructure/*` |
| `src/features/deploy` | `application/deploy`, `infrastructure/deploy` |
| `src/features/sessions` | `application/sessions`, `infrastructure/storage` |
| `src/plugins` | `infrastructure/plugins` |
| `src/infra/shared` | `shared` |
| `src/infra/*` adapters | `infrastructure/*` |

## First Architectural Moves

The first migration wave should not move everything. It should establish stable landing zones and remove the worst boundary violations first.

### Wave 1

- create the new top-level layer directories
- rewrite architecture docs so future work has a target
- stop adding new reusable logic to `services/`
- stop letting TUI or HTTP call `commands/*` for shared behavior

### Wave 2

- extract `application/sessions`
- extract `application/system`
- extract `application/config`
- make CLI and TUI call the same use cases

### Wave 3

- replace the chat runtime stub with a real `application/chat/run-chat` entrypoint
- consolidate duplicated permission and tool policies into `domain/permissions`
- move external execution logic behind ports

### Wave 4

- split oversized interface files into shell, controller, route, handler, and presenter modules
- move storage implementations fully behind application ports
- migrate search, LSP, MCP, and deploy into infrastructure-backed adapters

### Wave 5

- add architecture guardrails in CI
- enable stricter TypeScript settings for the new directories
- expand unit tests around use cases and ports

## Guardrails

The architecture only helps if it is enforced.

Current and recommended guardrails:

- architecture tests for allowed imports (`test/architecture-guardrails.test.ts`)
- legacy `platform/tui` removal checks (`test/platform/tui/minimal-surface.test.ts`)
- terminal-shell README parity tests (`test/platform/terminal/app/readme-alignment.test.ts`)
- public-doc portability checks (`test/public-docs-portability.test.ts`)
- strict TypeScript pass for `domain/shared` (`bun run lint:layers-strict`)
- `exactOptionalPropertyTypes` pass for `domain` (`bun run lint:domain-exact-optional`)
- `exactOptionalPropertyTypes` pass for `application/system` + `infra/shared` constructors (`bun run lint:application-system-exact-optional`)
- `exactOptionalPropertyTypes` pass for `application/permissions` + `application/sessions` (`bun run lint:application-permissions-sessions-exact-optional`)
- tracked-files-only secret hygiene scan (`bun run security:tracked`)
- dependency-boundary linting
- strict TypeScript for new layer directories first
- code review rule: every new feature must name its primary layer
- code review rule: UI and transport layers do not own reusable workflows

## What Not To Do

- do not split into microservices yet
- do not keep adding business logic to `services/`
- do not create new cross-cutting utility folders outside `shared`
- do not let new adapters call each other directly
- do not make `infrastructure` depend on concrete implementations from higher layers
- do not perform a big-bang rename before use-case boundaries exist

## Definition Of Done For The Migration

The migration is successful when these are true:

- new features land in the new layer directories by default
- reusable product actions live in `application`
- policies and rules have one clear home in `domain`
- provider and persistence code live behind `infrastructure`
- CLI, TUI, and HTTP surfaces share the same use-case entrypoints
- boundary checks prevent the old dependency drift from returning
