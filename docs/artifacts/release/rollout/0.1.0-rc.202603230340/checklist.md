# Rollout Checklist (0.1.0-rc.202603230340)

Generated: 2026-03-23T04:09:54.752Z
Bundle dir: `docs/artifacts/release/rollout/0.1.0-rc.202603230340`
Latest stage status: `docs/artifacts/release/rollout/0.1.0-rc.202603230340/status-stage10.md`

本清单用于执行 RC/Beta 发布后的分阶段放量门禁（10% -> 30% -> 100%）。

### Stage 10%

1. 填写指标文件：`docs/artifacts/release/rollout/0.1.0-rc.202603230340/metrics-stage10.json`
2. 执行评估：

```bash
pnpm release:rollout:check -- --metrics docs/artifacts/release/rollout/0.1.0-rc.202603230340/metrics-stage10.json --stage 10 --output docs/artifacts/release/rollout/0.1.0-rc.202603230340/report-stage10.json
```

3. 读取评估结果：`docs/artifacts/release/rollout/0.1.0-rc.202603230340/report-stage10.json`
4. 根据 exit code 判定：`0 promote / 1 hold / 2 rollback`
5. Promote target: 30%

### Stage 30%

1. 填写指标文件：`docs/artifacts/release/rollout/0.1.0-rc.202603230340/metrics-stage30.json`
2. 执行评估：

```bash
pnpm release:rollout:check -- --metrics docs/artifacts/release/rollout/0.1.0-rc.202603230340/metrics-stage30.json --stage 30 --output docs/artifacts/release/rollout/0.1.0-rc.202603230340/report-stage30.json
```

3. 读取评估结果：`docs/artifacts/release/rollout/0.1.0-rc.202603230340/report-stage30.json`
4. 根据 exit code 判定：`0 promote / 1 hold / 2 rollback`
5. Promote target: 100%

### Stage 100%

1. 填写指标文件：`docs/artifacts/release/rollout/0.1.0-rc.202603230340/metrics-stage100.json`
2. 执行评估：

```bash
pnpm release:rollout:check -- --metrics docs/artifacts/release/rollout/0.1.0-rc.202603230340/metrics-stage100.json --stage 100 --stableDays 7 --output docs/artifacts/release/rollout/0.1.0-rc.202603230340/report-stage100.json
```

3. 读取评估结果：`docs/artifacts/release/rollout/0.1.0-rc.202603230340/report-stage100.json`
4. 根据 exit code 判定：`0 promote / 1 hold / 2 rollback`
5. Promote target: Stable (GA)

## References

- `docs/release-rollout-runbook.md`
- `scripts/release/evaluate-rollout.mjs`
