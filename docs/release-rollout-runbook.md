# Release Rollout Runbook (RC -> Beta -> GA)

This runbook operationalizes the staged rollout policy:

1. release to RC/Beta channels first,
2. ramp traffic 10% -> 30% -> 100%,
3. enforce rollback thresholds,
4. promote to stable only after one week of healthy 100% traffic.

## 1) Prepare Channel Release

Generate a non-destructive release plan (branch + version suggestion + commands):

```bash
node scripts/release/prepare-channel.mjs --channel rc
node scripts/release/prepare-channel.mjs --channel beta
```

Use output `commands` as a copy/paste checklist for tagging and release prep.

## 2) Initialize Rollout Bundle (Recommended)

Generate stage templates and checklist for one release id:

```bash
pnpm release:rollout:init -- --release 0.1.0-rc.202603230340
```

Default output directory:

`docs/artifacts/release/rollout/<release>/`

Generated files:

- `metrics-stage10.json`
- `metrics-stage30.json`
- `metrics-stage100.json`
- `checklist.md`

If you need to regenerate an existing directory:

```bash
pnpm release:rollout:init -- --release 0.1.0-rc.202603230340 --overwrite
```

## 3) Ramp Plan

- Stage A: 10%
- Stage B: 30%
- Stage C: 100%

At each stage, collect a metrics file from observability (example shape below) and run the gate evaluator.

Example metrics JSON (`rollout-metrics.json`):

```json
{
  "stream": { "total": 1200, "errors": 6 },
  "findSymbol": { "total": 860, "timeouts": 4 },
  "attachRecovery": { "attempts": 210, "failures": 3 }
}
```

Evaluate stage gate:

```bash
pnpm release:rollout:check -- --metrics rollout-metrics.json --stage 10
pnpm release:rollout:check -- --metrics rollout-metrics.json --stage 30
pnpm release:rollout:check -- --metrics rollout-metrics.json --stage 100 --stableDays 7
```

Exit code semantics:

- `0` -> promote
- `1` -> hold
- `2` -> rollback

## 4) Rollback Thresholds

The gate evaluates three indicators:

- `/session/:id/message/stream` error rate
- `/find/symbol` timeout rate
- `attach` reconnect recovery failure rate

Current thresholds:

- **Hold**: stream >= 0.50%, symbol timeout >= 1.00%, attach recovery failure >= 1.50%
- **Rollback**: stream >= 1.50%, symbol timeout >= 2.50%, attach recovery failure >= 3.00%

If rollback threshold is hit, return to last stable release immediately.

## 5) GA Promotion Rule

After reaching 100% traffic, maintain healthy metrics for 7 days.
Only then promote from RC/Beta to stable.

Use:

```bash
pnpm release:rollout:check -- --metrics rollout-metrics.json --stage 100 --stableDays 7
```

Expected decision: `promote-to-stable`.
