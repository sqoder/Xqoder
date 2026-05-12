# ADR 0009 — Event Envelope 权威位置落在 infra,domain 不再持有副本

- 日期: 2026-05-10
- 相关期: P11.1 hotfix
- 状态: Accepted
- 上游决策触发: `docs/release/periodic-audit-3.md` §1.5、§4.A
- 用户决策: 方案 B(删 domain 版本,统一指向 `@xqoder/protocol` / `src/infra/protocol/events.ts`)

## 背景

P01 立仓时,CLAUDE.md 把 `src/domain/conversation/events.ts` 列为**硬红线**,原意是 domain 层持有 Event Envelope 协议的权威定义,上层只许读、不许改。但实际演进里真正被 runtime 使用、带 `schemaVersion:1` 的 `ConversationEventEnvelope` 一直住在 `src/infra/protocol/events.ts`(workspace 包 `@xqoder/protocol` 也对外 re-export 的是这一份)。domain 里那份保留了第二套联合类型 `ConversationEvent`(`user_message_accepted` / `assistant_text_delta` / …),没有 `schemaVersion`,只给 `src/application/chat/conversation-events.ts` 一个 caller 用,是历史遗物。

**两套并存**正是红线机制想防的漂移:新 caller 一眼看去不知道该选哪个。审查 3(periodic-audit-3)把这条升到 critical,按 CLAUDE.md "硬红线触发 → 停下问用户" 条款交用户拍板。

## 决策

**方案 B:删除 domain 版本,statement 权威位置在 infra。**

具体动作:
1. 删 `src/domain/conversation/events.ts`(旧 `ConversationEvent` 联合类型)。
2. `ConversationEvent` 唯一 src caller 是 `src/application/chat/conversation-events.ts`(里面的 `toConversationEvent()` 适配 envelope→legacy),把类型内联进该文件,不再外部 import。
3. `src/domain/conversation/transcript-projector.ts` **保留在 domain**。它 import `@xqoder/protocol` 的 `ConversationEventEnvelope`,虽然 periodic-audit-3 §1.1 把这归为 "[high] 分层违规",但项目内架构 guardrail 测试(`test/architecture-guardrails.test.ts`)已显式将 `@xqoder/protocol` 归类为 shared 层,domain → protocol 不违反 guardrail。本 ADR 不主动动 projector,原因:(a) application/domain/shared 禁止 import `core/commands/platform/infra` 的 guardrail 会阻止把 projector 搬到 core;(b) projector 的合理位置需要等 `src/infra/**` 与 `src/infrastructure/**` 合并路径明朗后再单独决策,强行先迁会造成再次迁移。projector 暂留 domain,待审查 §1.6 "两个 infra root" 合并 ADR 统一处理。
4. 更新所有 caller(domain events.ts 删除后):`src/application/chat/conversation-events.ts` 不再 import domain events。其他 caller 路径保持不变。
5. **CLAUDE.md 硬红线指针** 改为 `src/infra/protocol/events.ts`,并注明 schemaVersion:1。

## 方案 A vs B 的取舍

- **方案 A**:把 envelope 搬回 `src/domain/conversation/events.ts`,infra 改为转发。
  - 代价:`@xqoder/protocol` workspace 包 + `src/infra/protocol/events.ts` 都要改,调整 `ConversationEventEnvelopeEmitter` / `toConversationEventEnvelope` / `createConversationEventEnvelopeRecord` 的住处。
  - 顺带要解决 domain 不许 import 第三方包的约束(envelope 依赖 `CoreMessage` 从 `domain/conversation/messages.ts` 已经是 domain 内部,这部分 OK;但现有 runtime 已大量 `from '@xqoder/protocol'`,改向会涉及多个文件)。
  - 维持"domain 是协议权威"的口号,但其实 runtime 已经不这么用了,口号与事实割裂。

- **方案 B**(选):承认既成事实,把红线指针搬到事实所在之处。
  - 代价小:domain 仅删 1 个未被使用的副本 + 迁 1 个本就违反分层的文件。
  - 红线指针一次性纠偏,后续 envelope 改动的审查路径变清晰。
  - 副作用:`ConversationEventEnvelope(schemaVersion:1)` 的权威不再在 domain,但 domain 本身也没有任何消费 envelope 的逻辑 —— 没有丢掉任何 domain 语义。

B 的核心判断:**红线是为了锁定"真正会炸的文件",不是为了维持分层口号**。真正会炸的是 schemaVersion 那行字面 `1`,它在 infra,就把红线指到 infra。

## 代价和风险

- 风险 1:`domain/conversation/index.ts` 不再 re-export `events`/`transcript-projector`。任何外部 caller 若之前写 `from '...domain/conversation'` 拿 `ConversationEvent`,编译会断。grep 结果:src 里已无此类 caller(唯一 consumer `conversation-events.ts` 已改为内联),test 里也无。
- 风险 2:P12 工具调度施工可能会想碰 envelope。若要动 `schemaVersion` / 字段结构,必须遵循硬红线流程(停下 + ADR),目标文件现为 `src/infra/protocol/events.ts`。
- 风险 3:`@xqoder/protocol` workspace 包是否该同步搬 —— 本 ADR 不动 workspace 包,理由是 workspace 包外部契约未变,包含 `ConversationEventEnvelope` 的字面定义本来就在 `src/infra/protocol/events.ts`,workspace 包只是 re-export。后续若要统一 monorepo 布局,单独 ADR。

## 验收

- `bun x tsc --noEmit` 全绿(含 strict 套件)
- `test/domain/conversation/transcript-projector.test.ts`、`test/application/chat/conversation-events.test.ts`、`test/core/session-store-usage-persistence.test.ts` 全绿
- `bun run release:check` 本期 P11.1 收尾时跑(见 `docs/release/in-progress-p11.1.md` DoD §6)

## 关联文档

- `docs/release/periodic-audit-3.md` §1.5(问题根因)、§4.A(用户决策点)、§5(建议顺序)
- `docs/release/in-progress-p11.1.md`(P11.1 DoD + 实施顺序)
- `docs/adr/0008-p12-tool-orchestration.md`(P12 预定动工 — 本 ADR 落地后 envelope 权威位置已明)
