# Release Artifact Index

Generated: 2026-03-24T14:59:08.339Z

> Workflow parity and release state below are point-in-time snapshots from `origin`.
> Refresh with `pnpm capture:release:plans` before using this page for PR or release decisions.

## Release Plans

| Channel | Strict | File | SHA-256 |
|---|---|---|---|
| rc | no | docs/artifacts/release/prepare-rc.txt | 928ad4b30ccf524240c98bdda75a2d8d01dd2d9431e5bf1964c08d7b5f4080e7 |
| rc | yes | docs/artifacts/release/prepare-rc-strict.txt | c3833d32bf794f8704644ef350ae7aa0eeba4d18a59bd7c3ff6aa4ee506f417e |
| beta | no | docs/artifacts/release/prepare-beta.txt | 29086eb557872a2b50e8a9b4d7b8419f056a855b772587bd583455c05c9cd34a |
| beta | yes | docs/artifacts/release/prepare-beta-strict.txt | ad348366216fb66a5a7297463a55165fba5e3043311e4f179933bb7c405c3a5e |
| stable | no | docs/artifacts/release/prepare-stable.txt | feadff1a169a8eb546c6104e578d94c58235c2b001bd088875d21885f0ea9a91 |
| stable | yes | docs/artifacts/release/prepare-stable-strict.txt | c53d0e6d0d6e5c4fa0bf20ba67211e02d36e2b5811735fc73501f84ebe14aa81 |

## Workflow Parity

- file: docs/artifacts/release/workflow-parity.json
- sha256: 96ddc3f84bf1ca9f2325393fbe7c7ef7485380e45dc122aafb82fbfb5e61b4a0
- snapshot generated: 2026-03-24T14:59:05.074Z
- missing on remote: 4
- names: Benchmark Gates, Release Gate, Renderer Mode (rust) Tests, Session Recovery
- remote only: 1
- names: Manual E2E

## Release State

- file: docs/artifacts/release/release-state.json
- sha256: c4752c6accc4f7020c2a786b3876aedefc6312d73ae3217d0cc048fcca5058dc
- snapshot generated: 2026-03-24T14:59:07.938Z
- reference: origin/main
- reference commit: c9b233b6d4e23223370ad7d22cf2c43cbab41d8f
- local workspace version: 0.1.0
- current version on reference: 0.1.0-rc.202603230340
- expected stable tag: v0.1.0
- stable tag present on origin: no
- latest rc tag on origin: v0.1.0-rc.202603230340
- strict release gate available on reference: no
- strict dry-run available on reference: no
- strict gate ready on reference: no
- missing gate scripts on reference: release:check:strict, release:check:strict:dry-run, capture:release:plans, verify:contracts, verify:session:recovery, verify:terminal:main-path, verify:release:blockers

## Theme PR Plan

- file: docs/artifacts/release/theme-pr-plan.md
- sha256: ec856a0cad758dfa6f99c6bf02c90e93c3df278823a7c3f44f095a50656f2b16

## Week6 Stability Report

- file: docs/artifacts/week6/stability-report.md
- sha256: d95e132fb1292edbbf5cd84f68348f7b35da674bd9192c2c001bfda8ce986e7c

