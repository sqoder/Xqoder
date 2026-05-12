# 07 — MCP read-only information

The task asks a read-only question that can be answered entirely from the
snapshot in `inventory.json` — a list of SKUs with names, prices, and stock
levels. No side-effect tools are needed.

## Setup

- `inventory.json` is the fixture's stand-in for a read-only MCP resource
  (think: `read_resource` / `list_resources` style MCP calls).
- All other tools are unavailable in this scenario.

## Task

1. Read `inventory.json`.
2. Answer the following from the data:
   - Which SKU has the lowest stock?
   - Which SKUs cost more than 100?
3. Summarize the answer. Mention `MCP`, `read`, and one of
   `resource` / `prompt` / `tool` — the data came from the MCP read-only
   resource surface and no side-effect tool was invoked.
