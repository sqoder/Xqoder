# `src/infrastructure`

This directory owns side effects and external adapters.

Put here:

- persistence adapters
- shell execution
- model providers
- LSP and MCP adapters
- search, deploy, and notification integrations

Do not put here:

- reusable workflows
- product policies
- UI behavior

Allowed imports:

- `shared`
- application or domain contracts
