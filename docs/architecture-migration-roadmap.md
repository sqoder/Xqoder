# Architecture Migration Roadmap

This document turns the target architecture into an executable migration plan for the current repository.

## Goal

Move XQoder toward the new layered structure without stopping product development and without a big-bang rewrite.

## Scope

In scope:

- defining stable landing zones for new code
- removing the highest-value dependency violations first
- converging reusable workflows into `application`
- pushing side effects behind ports and adapters

Out of scope for the first pass:

- renaming every existing directory
- fully deleting `core`, `features`, `platform`, or `infra`
- introducing microservices
- turning the repository into a monorepo

## Phases

### Phase 0: Guardrails

Deliverables:

- new architecture docs in the repository
- new top-level layer directories under `src/`
- code review rule: every new feature must name a primary layer

Exit criteria:

- new work has an explicit landing zone
- architectural intent is documented inside the repo instead of only in chat history

### Phase 1: Sessions, System, Config

Focus:

- extract reusable use cases from CLI and TUI
- stop `platform/tui` from reusing `commands/*` as an application layer

Target areas:

- `application/sessions`
- `application/system`
- `application/config`

Likely source files:

- `src/commands/sessions/*`
- `src/commands/system/*`
- `src/platform/tui/session/*`
- `src/services/config-service.ts`

Exit criteria:

- CLI and TUI share the same session, memory, hook, and permission use cases
- `services/` starts shrinking instead of growing

### Phase 2: Chat And Agent Entry

Focus:

- replace the current chat stub with a single real application entrypoint
- unify duplicated tool and permission policy logic

Target areas:

- `application/chat`
- `application/agent`
- `domain/permissions`
- `domain/agent`

Likely source files:

- `src/core/runtime/chat-runner.ts`
- `src/commands/core/chat.ts`
- `src/core/agent/*`
- `src/platform/tui/agent/*`

Exit criteria:

- chat has one canonical orchestrator
- permission policy lives in one place

### Phase 3: Interface Decomposition

Focus:

- break oversized interface adapters into smaller transport and presentation modules

Target areas:

- `interfaces/http`
- `interfaces/tui`

Likely source files:

- `src/platform/server/index.ts`
- `src/platform/terminal/app/run-terminal-app.ts`

Exit criteria:

- transport, controller, and presentation concerns are separated
- no single interface file remains a product-wide god object

### Phase 4: Ports And Adapters

Focus:

- push persistence and external execution behind clear port interfaces

Target areas:

- `application/*` ports
- `infrastructure/storage`
- `infrastructure/shell`
- `infrastructure/plugins`
- `infrastructure/lsp`
- `infrastructure/mcp`

Likely source files:

- `src/infra/storage/*`
- `src/platform/terminal/*`
- `src/plugins/*`
- `src/infra/llm/*`

Exit criteria:

- infrastructure depends on contracts, not on higher-level implementations
- application orchestrates external capabilities through ports

### Phase 5: Enforcement And Cleanup

Focus:

- add stronger boundary checks
- tighten TypeScript on the new directories
- migrate old folders opportunistically as feature work happens

Exit criteria:

- new work no longer chooses `services/`, `features/`, or `platform/*` as the default home for reusable logic
- the new architecture is the default path, not a side plan

## Review Checklist For Future PRs

Use this checklist before merging architecture-affecting changes:

1. What is the primary layer for this feature?
2. Does the interface layer only parse input and render output?
3. Is reusable behavior implemented as an application use case?
4. Are rules and policies stored in one domain home?
5. Are side effects behind infrastructure adapters or ports?
6. Did this change create a new cross-layer dependency that should be forbidden?

## Recommended First PRs

If the migration is done incrementally, these are the highest-value first PRs:

1. Add `application/sessions`, `application/system`, and `application/config` use cases.
2. Stop `platform/tui` from importing `commands/*` as shared logic.
3. Replace the chat stub with a real application entrypoint.
4. Consolidate permission policy duplication into one domain module.
5. Split the server and TUI entry adapters into smaller modules.
