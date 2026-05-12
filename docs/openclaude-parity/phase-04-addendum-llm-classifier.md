# Phase 04 补遗 · LLM 驱动的 yolo 分类器（两阶段）

## 背景

v1 的 phase-04 假设 yolo 分类器是纯正则。**这是错的**。经阅读源码
（`openclaude/src/utils/permissions/yoloClassifier.ts`，1603 行）确认：

- OpenClaude 的 yoloClassifier 是一个 **两阶段 LLM 分类器**：
  - Stage 1：用一个轻量模型（Haiku 类）判断 `shouldBlock`。
  - Stage 2：用一个稍大的模型复核 + 给 `reason`。
  - Stage 1 可解析失败即 "blocking for safety"（保守）。
- 它需要独立的 `BetaToolUnion` 工具 schema（`classify_result`）。
- 有独立的 telemetry：`tengu_auto_mode_outcome`。
- 有独立的 abort 控制 + headroom 预算（否则 stop_reason=max_tokens 会报误判）。
- 有 **classifier transcript exceeded context window** 保护。
- 对应 feature flag：`TRANSCRIPT_CLASSIFIER`、`BASH_CLASSIFIER`。

**另一侧**还有一个 **规则式** 的 `bashClassifier.ts`
（`openclaude/src/utils/permissions/bashClassifier.ts`）和
`dangerousPatterns.ts`，提供 **快速拒绝** 与 **已知安全白名单**。
`yoloClassifier` 只在 **规则不能决定** 时才请求 LLM。

本补遗把 phase-04 的 "yolo 分类器" 部分重写为两层结构，原 phase-04 文档
中"auto 下对 shell 调分类器"那一段替换为下述设计。

## 任务目标（必须可验证）

### 成功判定

- 实现 `src/domain/permissions/classifier/decideShellPolicy(command, cwd, session)`，
  先跑规则：
  - `bashClassifier.rules.dangerous(cmd)` 命中 → `deny`。
  - `bashClassifier.rules.safe(cmd)` 命中 → `allow`。
  - 否则调 `yoloClassifier.classify(command, session)`：
    - stage1 → block?
    - stage2 → confirm block?
    - 任何一段解析失败 → `deny`（保守）。
- `yoloClassifier` **默认关闭**，通过 `XQODER_FEATURE_PERMISSION_YOLO_CLASSIFIER=1`
  开启。关闭时只走规则；任何 "未命中规则" → `ask`。
- 分类器调用一律用 **独立 provider 实例**（不复用主对话的 provider 会话；
  避免污染主对话缓存、消耗主对话 turn budget）。
- 全仓新增 ≥ 30 条样本测试：样本分三档（safe / risky / dangerous），
  且每档覆盖正则命中 + LLM 兜底 两种 code path。

## 背景与上下文

- v1 phase-04 的类型修改和权限流程落点不变，仅"分类器"部分替换。
- 关键源头文件：
  - `openclaude/src/utils/permissions/yoloClassifier.ts`（LLM 驱动）
  - `openclaude/src/utils/permissions/bashClassifier.ts`（规则）
  - `openclaude/src/utils/permissions/dangerousPatterns.ts`（黑名单）
  - `openclaude/src/utils/permissions/classifierShared.ts`（共享 ctx）
  - `openclaude/src/utils/permissions/classifierDecision.ts`（决策聚合）
  - `openclaude/src/utils/permissions/autoModeState.ts`（线程态）
  - `openclaude/src/utils/permissions/denialTracking.ts`（拒绝统计）
  - `openclaude/src/utils/classifierApprovals.ts`（上层 bridge）
  - `openclaude/src/utils/classifierApprovalsHook.ts`（hook）
  - `openclaude/src/utils/autoModeDenials.ts`（拒绝记录）

## 范围与边界

### 允许修改

- 新增 `src/domain/permissions/classifier/` 目录：
  - `dangerous-patterns.ts`
  - `safe-patterns.ts`
  - `rule-classifier.ts`
  - `llm-classifier.ts`
  - `decide.ts`
  - `types.ts`
  - `__tests__/*`
- 新增 `src/infra/permissions/classifier-provider.ts`
  （从现有 `core/agent/llm/factory.ts` 拿到一个**独立**的小模型 provider）。
- 新增 `src/core/agent/denial-tracking.ts`
  （记录"该 session 已经被分类器拒绝多少次"，用于降级到 ask）。

### 禁止修改

- 不改 `AgentSession` 的公共字段。
- 不改 `conversation-engine.ts`。
- 不改 `tool-orchestrator.ts` 对外签名（只在内部新增一步 decide）。

## 执行步骤

### 一、数据结构

```ts
// types.ts
export type ShellDecision = 'allow' | 'ask' | 'deny';

export interface ClassifierResult {
    decision: ShellDecision;
    reason: string;
    source: 'rule-safe' | 'rule-dangerous' | 'llm-stage1' | 'llm-stage2'
            | 'llm-unavailable' | 'llm-timeout' | 'fallback';
    stage1Usage?: Usage;
    stage2Usage?: Usage;
    model?: string;
}
```

### 二、规则层（rule-classifier.ts）

```ts
import { DANGEROUS_PATTERNS } from './dangerous-patterns.js';
import { SAFE_PATTERNS } from './safe-patterns.js';

export function classifyByRule(command: string): ClassifierResult | null {
    const cmd = command.trim();
    for (const p of DANGEROUS_PATTERNS) {
        if (p.re.test(cmd)) return { decision: 'deny', reason: p.reason, source: 'rule-dangerous' };
    }
    for (const p of SAFE_PATTERNS) {
        if (p.re.test(cmd)) return { decision: 'allow', reason: p.reason, source: 'rule-safe' };
    }
    return null; // 交给 LLM
}
```

`dangerous-patterns.ts / safe-patterns.ts` 的条目需对照
`openclaude/src/utils/permissions/dangerousPatterns.ts` 逐条拷贝。
本补遗不展开所有正则（项目内严格按源头同步）。

### 三、LLM 分类层（llm-classifier.ts）

```ts
import { z } from 'zod';

const CLASSIFY_TOOL_SCHEMA = {
    name: 'classify_result',
    description: 'Return whether the command should be blocked.',
    input_schema: {
        type: 'object',
        properties: {
            block: { type: 'boolean' },
            reason: { type: 'string' },
        },
        required: ['block', 'reason'],
        additionalProperties: false,
    },
} as const;

export async function classifyByLlm(input: {
    command: string;
    transcriptTail: LLMMessage[]; // 最近 4 条消息做上下文
    provider: ILLMProvider; // 独立 provider（stage1 用小模型）
    provider2?: ILLMProvider; // 独立 provider（stage2 可用同模型）
    signal: AbortSignal;
    budgetTokens?: number;
}): Promise<ClassifierResult> {
    // Stage 1
    const stage1 = await requestClassification(input.provider, {
        command: input.command,
        transcriptTail: input.transcriptTail,
        tools: [CLASSIFY_TOOL_SCHEMA],
        budgetTokens: input.budgetTokens ?? 512,
        signal: input.signal,
    });

    if (!stage1.parsed) {
        return { decision: 'deny', reason: 'Classifier stage 1 unparseable', source: 'llm-stage1',
                 stage1Usage: stage1.usage, model: stage1.model };
    }
    if (!stage1.parsed.block) {
        return { decision: 'allow', reason: stage1.parsed.reason, source: 'llm-stage1',
                 stage1Usage: stage1.usage, model: stage1.model };
    }

    // Stage 2 确认
    const provider2 = input.provider2 ?? input.provider;
    const stage2 = await requestClassification(provider2, {
        command: input.command,
        transcriptTail: input.transcriptTail,
        tools: [CLASSIFY_TOOL_SCHEMA],
        budgetTokens: input.budgetTokens ?? 512,
        signal: input.signal,
    });
    if (!stage2.parsed) {
        return { decision: 'deny', reason: 'Classifier stage 2 unparseable', source: 'llm-stage2',
                 stage1Usage: stage1.usage, stage2Usage: stage2.usage, model: stage2.model };
    }
    if (stage2.parsed.block) {
        return { decision: 'deny', reason: stage2.parsed.reason, source: 'llm-stage2',
                 stage1Usage: stage1.usage, stage2Usage: stage2.usage, model: stage2.model };
    }
    return { decision: 'allow', reason: stage2.parsed.reason, source: 'llm-stage2',
             stage1Usage: stage1.usage, stage2Usage: stage2.usage, model: stage2.model };
}
```

`requestClassification` 是极薄的 wrapper：把消息封成
`[{role:'user', content: `Classify this shell command...${command}`}]`，
只允许返回 `classify_result` 工具调用，任何其它形式视为 `parsed: null`。

### 四、决策聚合（decide.ts）

```ts
export async function decideShellPolicy(input: {
    command: string;
    session: AgentSession;
    permissionMode: AgentPermissionMode;
    feature: { yolo: boolean };
    makeClassifierProvider: (tier: 1 | 2) => ILLMProvider;
    signal: AbortSignal;
}): Promise<ClassifierResult> {
    // 1) 规则
    const rule = classifyByRule(input.command);
    if (rule) return rule;

    // 2) LLM（仅在 auto 且 flag 开启时）
    if (input.permissionMode === 'auto' && input.feature.yolo) {
        try {
            return await classifyByLlm({
                command: input.command,
                transcriptTail: input.session.getMessages().slice(-4),
                provider: input.makeClassifierProvider(1),
                provider2: input.makeClassifierProvider(2),
                signal: input.signal,
                budgetTokens: 512,
            });
        } catch (err) {
            return { decision: 'deny', reason: 'Classifier unavailable', source: 'llm-unavailable' };
        }
    }

    // 3) 其它模式：rule 不命中 → ask
    return { decision: 'ask', reason: 'Unknown command; asking user', source: 'fallback' };
}
```

### 五、集成点

- `src/domain/permissions/tool-policy.ts::resolveToolPermissionMode`
  在 v1 phase-04 插入的 "auto + shell" 分支里，**替换**为：
  ```ts
  if (mode === 'auto' && isShellLikeTool(toolName)) {
      const result = await decideShellPolicy({
          command: extractShellCommand(input),
          session,
          permissionMode: mode,
          feature: { yolo: feature('PERMISSION_YOLO_CLASSIFIER') },
          makeClassifierProvider: classifierProviderFactory,
          signal: sessionSignal,
      });
      if (result.decision === 'deny') return 'deny';
      if (result.decision === 'ask') return 'ask';
      return 'allow';
  }
  ```
- `classifierProviderFactory` 从 `src/infra/permissions/classifier-provider.ts`
  读：
  ```ts
  export function classifierProviderFactory(tier: 1 | 2): ILLMProvider {
      const modelName = tier === 1 ? 'claude-3-5-haiku-latest' : 'claude-3-7-sonnet-latest';
      return createLlmProvider({ provider: 'anthropic', model: modelName, apiKey: readAnthropicKey() });
  }
  ```
  （Anthropic key 不存在时退化到 OpenAI 兼容小模型，如 `qwen-turbo`；该决策
  由已有 `core/agent/llm/factory.ts` 再接一层 alias 完成）。

### 六、denial tracking

- `src/core/agent/denial-tracking.ts`：记录当前 session 被分类器 deny 的次数。
  当 denyCount ≥ 3，decideShellPolicy 自动把后续 LLM 结果降级为 `ask`（给用户
  接管权）——对应 OpenClaude 的 `denialTracking.ts` 行为。

## 验证方案

- 规则单测 ≥ 18 条（与 phase-04 原先计划一致）。
- LLM 单测 ≥ 10 条，用 **mock provider** 模拟 parsed / unparsed / throttle /
  stage1 safe / stage2 deny / stage2 flip / timeout 六条路径。
- 集成测试：
  - flag off → 仅规则 + ask fallback；
  - flag on + deny pattern → 不触发 LLM；
  - flag on + unknown cmd → stage1+stage2 执行；
  - flag on + denyCount=3 → 降级 ask。

## 风险与回退

- **风险**：分类器延迟叠加到工具调用 → 用户体感卡顿（Haiku 约 300–600ms）。
  **缓解**：`budgetTokens: 512`，stage 模型尽量用 Haiku；stage2 仅在 stage1=block 时触发。
- **回退**：`XQODER_FEATURE_PERMISSION_YOLO_CLASSIFIER=0` 关 LLM 层，只留规则。

## 不确定项

- OpenClaude 的 prompt 文本（system + user）本文档没有照搬。为避免抄袭风险，
  自行编写一版 "Classify this shell command for safety…" 即可；前置 transcript
  上下文按最近 4 条注入。施工者可视效果再调。
- OpenClaude 对"2 阶段是否一定使用不同模型"没有硬规定；本期默认 stage1=Haiku、
  stage2=Sonnet 级别，若 Haiku 准确度已够则直接取消 stage2。
