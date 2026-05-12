# Phase 16 · AgentTool + 内置 subagent + forkSubagent + agentMemory

## 任务目标（必须可验证）

把 `DelegateTaskTool` 升级到 OpenClaude `tools/AgentTool/**` 的水平：

- 支持 built-in agent：`explore / plan / general-purpose / verification / claude-code-guide`（保留现有 `explore / plan` + 新增 3 个）。
- 自动从 `~/.xqoder/agents/*.md` 加载 markdown agent（已有 `markdown-agents.ts`，需扩展解析 `provider / model / baseUrl / allowedTools`）。
- `forkSubagent(parent, subagent)` 派生子 session：继承 readFileState 克隆、独立 usage、
  独立 AbortController。
- 子 agent 结果回填 parent 为 `tool_result`。
- `AgentMemory` 把子 agent 的"已读文件 / 已写笔记"透回主 session（snapshot）。

## 对标源

- `openclaude/src/tools/AgentTool/AgentTool.tsx`
- `openclaude/src/tools/AgentTool/runAgent.ts`
- `openclaude/src/tools/AgentTool/forkSubagent.ts`
- `openclaude/src/tools/AgentTool/agentMemory.ts`
- `openclaude/src/tools/AgentTool/agentMemorySnapshot.ts`
- `openclaude/src/tools/AgentTool/agentColorManager.ts`
- `openclaude/src/tools/AgentTool/loadAgentsDir.ts`
- `openclaude/src/tools/AgentTool/builtInAgents.ts`
- `openclaude/src/tools/AgentTool/built-in/*.ts`
- `openclaude/src/tools/AgentTool/resumeAgent.ts`
- `openclaude/src/utils/forkedAgent.ts`

## 范围与边界

### 允许修改

- `src/core/agent/tools/agent-tool.ts` 扩展。
- 新增 `src/core/agent/subagents/`:
  - `built-in.ts`
  - `fork.ts`
  - `memory.ts`
  - `memory-snapshot.ts`
  - `resume.ts`
- `src/core/agent/markdown-agents.ts` 扩展 frontmatter 字段。

### 禁止修改

- `runConversationTurn` 外部签名。

## 改动要点

### 1) built-in agents 配置

```ts
// src/core/agent/subagents/built-in.ts
export const BUILT_IN_AGENTS: Record<string, BuiltInAgent> = {
    'explore': {
        systemPrompt: exploreSystemPrompt,
        allowedTools: ['read_file', 'grep_content', 'glob_files', 'list_files', 'lsp_*'],
        concurrencySafe: true,
    },
    'plan': {
        systemPrompt: planSystemPrompt,
        allowedTools: ['read_file', 'grep_content', 'glob_files', 'list_files'],
        concurrencySafe: true,
    },
    'general-purpose': {
        systemPrompt: generalSystemPrompt,
        allowedTools: '*',
        concurrencySafe: false,
    },
    'verification': {
        systemPrompt: verificationSystemPrompt,
        allowedTools: ['read_file', 'run_shell'],
        concurrencySafe: false,
    },
    'claude-code-guide': {
        systemPrompt: codeGuideSystemPrompt,
        allowedTools: ['read_file', 'grep_content', 'lsp_*'],
        concurrencySafe: true,
    },
};
```

具体 systemPrompt 文本自行按 OpenClaude 对应文件参考改写（注意不逐行抄袭）。

### 2) forkSubagent

```ts
// src/core/agent/subagents/fork.ts
export async function forkSubagent(parent: AgentSession, spec: SubagentSpec): Promise<AgentSession> {
    const child = await parent.store.create({
        parent: parent.id,
        sourceType: 'fork',
        sessionMetadata: { subagent: spec.name },
    });

    // 克隆 readFileState
    child.setFileState(cloneFileState(parent.getFileState()));

    // 复制 baseSystem + append sub-agent systemPrompt
    child.setBaseSystem(buildSubagentSystemPrompt(parent, spec));

    return child;
}
```

### 3) agentMemory snapshot

```ts
export async function snapshotSubagentMemory(child: AgentSession): Promise<AgentMemorySnapshot> {
    return {
        readFiles: [...child.getReadFileIds()],
        writtenNotes: child.getWrittenNotes(),
        finalResponse: child.getLastAssistantMessage(),
        usage: child.getUsage(),
    };
}
```

### 4) 并发限制

- 单轮内最多 4 个 concurrent fork（对齐 OpenClaude）。
- AgentTool 里保持 `concurrencySafe: true`（对应 phase-12），让主 agent
  可并发派多个 explore agent。

### 5) markdown agent frontmatter 扩展

```yaml
---
name: my-explorer
description: "..."
mode: subagent
provider: dashscope
model: qwen-plus
baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1
allowedTools: [read_file, grep_content, lsp_*]
permissionMode: acceptEdits
color: cyan
---
System prompt here.
```

frontmatter 解析加 `provider / model / baseUrl / color` 字段（其余已有）。

## 验证

- Unit：`BUILT_IN_AGENTS` 5 条全部可加载 + generateToolPool 正确过滤。
- e2e：主 agent 并发派 3 个 explore agent → 观察 3 个独立 child session 写回。

## 风险与回退

- **风险**：fork 导致的 DB / store 膨胀。
  **缓解**：child session 在 parent 完成后主动 `purge`（保留 usage 与 finalResponse，
  删除详细消息）。

## 不确定项

- OpenClaude 的 `resumeAgent.ts` 允许跨进程恢复子 agent。本期 v1 只支持同进程；
  持久化恢复留给 phase-24 的 session lifecycle。
