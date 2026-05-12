# Phase 24 补遗 · AgentTool rewrite(P16c 延期债)

## 背景

P16c(ADR 0026)把 `forkSubagentsBatch` 作为纯模块落地,但 **没有**
rewrite `DelegateTaskTool` (`src/core/agent/tools/agent-tool.ts`,289 行)。
原因:

1. 当前 `AgentSession` 只在内存里活,`createChildSession` 做不到
   fork-then-resume,必须等 P24 session 持久化先定型。
2. DelegateTaskTool 的 wire format 一改,所有现存测试 + golden task 的
   `agent: ... iterations: ... final: ...` 断言全部失效,需要一次性切换。
3. 软红线 `src/core/agent/**` 大面积改动在同一期做风险过高。

P16a/P16b/P16c 已把 **所有构件** 备齐:registry、markdown frontmatter、
forkSubagent、AgentMemory snapshot、batch coordinator、
`areAllConcurrencySafe` 判定。rewrite 本身不再需要新模块——只差集成。

## 触发条件

P24 session lifecycle 落地之后,**且**满足以下两条:

- `SessionStore` 能承载子会话(fork 出的 child session 可被持久化、
  resume、rewind)。
- `createChildSession` 返回值改成持久化会话句柄,而非 in-memory
  messages 数组。

P24 收尾时再开一个 P24 补遗 / 或新开一期 **P16d**,做 rewrite + 迁移。

## 范围

### 必改

- `src/core/agent/tools/agent-tool.ts::DelegateTaskTool.execute`
  按 ADR 0026 "集成 recipe" 重写,使用 `forkSubagentsBatch` +
  `renderAgentMemorySnapshot`。
- 子会话接入 P24 的 SessionStore(新建 session → 记录 parentSessionId
  → 结束时 snapshot 落盘)。
- 更新所有断言旧 wire format 的测试(转换为断言 memory snapshot 格式)。
- Golden task 若断言旧格式,同步更新。

### 不改

- `forkSubagentsBatch` / `forkSubagent` / `AgentMemory` 任何一个
  (P16a/b/c 已定稿,只被消费)。
- 软红线 `conversation-engine.ts`、`permission-gate.ts`、
  `tool-orchestrator.ts` 的对外签名。

## 集成 recipe(权威版本在 ADR 0026)

```ts
// Inside DelegateTaskTool.execute, once P24 lands:
const agent = getBuiltInAgent(delegateConfig.agentName) ?? /* markdown */;
const tools = filterToolsForAgent(parentToolNames, agent);
assertToolsAllowed(tools, agent);

const specs: ForkSpec[] = [{ agent, task, toolNames: tools, signal: context.signal }];

const outcomes = areAllConcurrencySafe(specs)
    ? await forkSubagentsBatch(parent, specs, { createChildSession, runChild })
    : await runSerial(parent, specs, { createChildSession, runChild });

return {
    toolCallId,
    success: outcomes.every((o) => o.status === 'ok'),
    output: outcomes.map((o) =>
        o.status === 'ok'
            ? renderAgentMemorySnapshot(o.result.snapshot)
            : `fork failed: ${o.error.message}`,
    ).join('\n\n---\n\n'),
};
```

`runChild` 是 `runConversationTurn` 的薄 wrapper:child session +
受限 tool registry + fork 的 abort signal。

## 验收

- 原有 P16a/b/c 测试(runtime registry、markdown、forkSubagent、
  AgentMemory、batch 协调器、`areAllConcurrencySafe`)**全部保持绿色**。
- 新增测试:
  - `DelegateTaskTool.execute` 用 mock child session 验证:
    - 单 spec → memory snapshot 作为 tool_result 输出。
    - 多 spec concurrency-safe → `forkSubagentsBatch` 路径。
    - 多 spec 有非并发安全 → serial 路径。
    - 单 fork 失败不污染其它 fork。
  - 跨会话恢复用例:fork → 写盘 → 主会话重启 → memory snapshot
    仍然可拿到(这一条是 **P24 + P16d 联合验收**,没有 P24 跑不通)。
- release:check 通过,golden task 通过率不下降。

## 风险

- **wire format breakage**:所有依赖
  `agent: ... iterations: ... final: ...` 的测试/golden 一次性改。
  缓解:改前用 `rg -n "iterations:"` 扫全仓列清单,一次 PR 全部同步。
- **memory snapshot 长度失控**:子会话 transcript 全量塞进
  tool_result 会触发主会话 compaction。缓解:在
  `renderAgentMemorySnapshot` 里加硬上限(按 token,不按行),
  超出则只保留 final + last N turns。

## 回退

rewrite 一旦 land 就难以回退(旧 wire format 的生产者消失)。上线前
**必须** 在 feature flag `XQODER_FEATURE_AGENT_TOOL_REWRITE` 下灰度,
默认 off,验证一周再反转默认值。
