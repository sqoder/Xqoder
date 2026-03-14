# Release Notes Draft: Serve OpenAPI Contract Maturity

## Scope

This draft summarizes the recent documentation-contract hardening work for the `serve` API. It focuses on OpenAPI quality improvements intended to make SDK generation and client integration more predictable, without changing runtime business behavior.

Included slices:

- `401` auth response and BasicAuth security declaration
- endpoint `tags` and response content-type precision
- standardized core `2xx` response examples
- `servers` deployment context descriptions

## Why This Matters

- Improves generated client correctness (`operationId`, response schemas, auth semantics).
- Reduces integration ambiguity for API consumers (`content-type`, examples, error references).
- Makes deployment targets clearer for local and hosted environments (`servers` variables).

## Highlights

### 1) Auth Semantics in OpenAPI

- Added global BasicAuth security declaration.
- Added reusable `UnauthorizedError` response.
- Added explicit `401` references on key endpoints to match runtime auth behavior.

Impact:

- Generated clients now model auth requirements and unauthorized responses more accurately.

### 2) Endpoint Grouping and Content-Type Precision

- Added route tags: `system`, `search`, `session`, `stream`, `share`, `docs`.
- Refined `200` content types for key endpoints:
  - `/doc`: `text/html` and `application/json`
  - `/event`: `text/event-stream`

Impact:

- Better API navigation in docs/SDK tooling.
- Correct media-type handling for docs endpoint negotiation and SSE consumers.

### 3) Standardized Success Examples

- Added consistent examples for core `2xx` responses:
  - health/project/config/provider
  - find/find-file/find-symbol/file
  - session list/create/get/message
  - question resolve / stream cancel

Impact:

- Faster client onboarding and easier mock/testing setup.

### 4) Server Deployment Contexts

- Added two `servers` entries:
  - current runtime endpoint
  - parameterized endpoint `http://{host}:{port}` with variables

Impact:

- SDK consumers can switch between local/dev/prod targets with clearer conventions.

## Endpoint Contract Consistency

The OpenAPI now consistently uses reusable response components for common errors across serve endpoints:

- `BadRequestError` (`400`)
- `UnauthorizedError` (`401`)
- `NotFoundError` (`404`)
- `ConflictError` (`409`)
- `InternalServerError` (`500`)
- `ServiceUnavailableError` (`503`)

## Validation Summary

Validated with:

- `pnpm --filter @xqoder/cli build`
- `pnpm --filter @xqoder/cli exec vitest run src/server/index.test.ts`
- `pnpm parity:test`

Notes:

- LSP warnings shown in temp test workspaces are expected and do not affect pass/fail.

## Compatibility and Risk

- Runtime behavior: unchanged (documentation-contract enhancement only).
- Backward compatibility: preserved for existing API consumers.
- Risk: low; changes are additive/clarifying in OpenAPI metadata.

## Commits Included in This Batch

- `97ebce0` - document BasicAuth and `401` responses in OpenAPI
- `3a4c834` - add tags and content-type precision
- `e236da0` - standardize core `2xx` examples
- `7ccea1c` - describe OpenAPI servers for deployment contexts

## Suggested Release Note Snippet (Short Form)

`serve` API documentation quality has been significantly improved for integration workflows: OpenAPI now includes explicit auth semantics (`401` + BasicAuth), endpoint tags, precise content types for docs/SSE routes, standardized success examples for core flows, and deployment-oriented server definitions. These are documentation-contract enhancements and do not change runtime behavior.
