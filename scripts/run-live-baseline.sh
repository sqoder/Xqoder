#!/bin/sh
# Run 1 baseline — Anthropic provider, auto-detected from ANTHROPIC_API_KEY
export XQODER_LLM_PROVIDER=anthropic
export XQODER_LLM_MODEL=claude-haiku-4-5-20251001
exec bun run scripts/run-golden-tasks.ts \
  --manifest docs/golden-tasks/xqoder-live-coding.json \
  --live
