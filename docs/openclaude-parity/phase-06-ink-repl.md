# Phase 06 · Ink REPL 替换现有 readline 输出

## 任务目标（必须可验证）

把现在基于 `readline + stdout.write` 的终端实现，替换为以 Ink（React in
Terminal，`ink@6 + react@19` 依赖已在 `package.json`）渲染的 REPL。
CLI 入口 `xqoder chat` / `xqoder` 默认行为保持一致，只是 UI 层换引擎。

### 成功判定

- 运行 `bun dist/index.js chat "……"` 进入 REPL：
  - 顶部 status bar：当前 provider / model / sandboxMode / tokens this session。
  - 消息区：用户 / assistant 消息可滚动；assistant 消息带流式光标。
  - 工具调用块：可折叠，stdout / stderr 分色。
  - thinking 块：折叠显示 ≤ 5 行预览，按 `Tab` 展开。
  - approval 弹窗：键盘驱动（`y / n / a always / d deny`），阻塞主流直到选择。
  - 底部输入框：多行、方向键、历史（↑/↓ 翻回往轮）。
- 现有 `--prompt`（headless）行为完全不变（不走 Ink）。
- 现有 `serve` 模式、HTTP 事件流（`interfaces/http/*`）不受影响。
- `bun run build` 产物尺寸增加 ≤ 1MB（Ink+React 都是小依赖）。

---

## 背景与上下文

- 已声明依赖：`ink@6`、`react@19`、`string-width@4`。实际 import 次数为 0。
- 现有文件：`src/platform/terminal/app/run-terminal-app.ts`（readline 主循环）、
  `terminal-scrollback-output.ts`（stdout 格式化）。
- 事件流源头：`ConversationEventEnvelope`（`src/domain/conversation/events.ts`），
  `conversation-engine.ts` 已经把整条对话事件化——这是接 Ink 的 **天然 props 源**。

---

## 问题/需求定义

### 当前现象

- `readline` 不能同时更新多行（只能逐行 append），实现 status bar / 折叠块
  几乎不可能。
- 工具审批用 `question()` 串行阻塞，不能和流式输出并存。
- 无法用键盘整体滚动。

### 触发条件

- 交互式进入 REPL（无 `--prompt`）。

### 预期行为

- Ink 组件树 `<App>` 订阅 `ConversationEventEnvelope`，派发到子组件。
- 输入/审批/历史通过 hook（`useInput`）捕获。

---

## 范围与边界

### 允许修改

- 新增 `src/platform/terminal/ink/` 目录：
  - `app.tsx`（顶层）
  - `components/StatusBar.tsx`
  - `components/MessageList.tsx`
  - `components/Message.tsx`（user / assistant 两种）
  - `components/ToolBlock.tsx`
  - `components/ThinkingBlock.tsx`
  - `components/ApprovalDialog.tsx`
  - `components/PromptInput.tsx`
  - `hooks/useConversationStream.ts`
  - `hooks/useHistoryBuffer.ts`
  - `hooks/useApprovalQueue.ts`
  - `theme.ts`
  - `index.tsx`（`renderInkApp(deps): Promise<void>`）
- 修改 `src/platform/terminal/app/run-terminal-app.ts`：
  在 **交互模式**（未传 `--prompt`）时，调用 `renderInkApp(...)`；否则保留现有路径。
- 修改 `apps/vscode-extension` **不动**。
- 修改 `src/bootstrap/cli-main.ts` **不动**（CLI 仍走原路）。
- `tsconfig.json`：启用 `"jsx": "react-jsx"` 对 Ink 目录（可用
  `tsconfig.platform-terminal-strict.json` 分支 include）。

### 禁止修改

- `conversation-engine.ts` 事件协议。
- 除 TUI 外的任何 application 层。
- 现有 `--prompt` headless 路径。

### 限制

- 不引入新依赖（仅用已声明的 `ink / react / string-width`）。
- 单文件 ≤ 300 行（size guardrail）。
- 终端必须是 TTY 才进 Ink；非 TTY（如 piped output）走旧路径。

---

## 执行步骤

### 一、行为建模

- 事件 → state → render 单向流：
  - `conversation-engine` emit `ConversationEventEnvelope`
  - `useConversationStream` reduce 成 `{ messages, toolCalls, thinkingBlocks, status, approvals }`
  - `<App>` 派发给子组件

- 输入 → 事件：
  - `PromptInput` 捕获回车 → 调用 `onSubmit(text)`
  - `ApprovalDialog` 捕获 `y/n/a/d` → resolve pending approval promise

### 二、任务拆解

| 模块 | 职责 |
|---|---|
| `renderInkApp(deps)` | Ink 入口，创建 store / 订阅事件 / 挂顶层 App |
| `useConversationStream` | 对齐 `ConversationEventEnvelope` 的 reducer |
| `StatusBar` | provider / model / session tokens / cost |
| `MessageList + Message` | 消息流渲染，支持 stream |
| `ToolBlock` | 工具块折叠，输出分色 |
| `ThinkingBlock` | thinking 折叠 |
| `ApprovalDialog` | 审批弹窗（阻塞主流） |
| `PromptInput` | 输入框，历史翻回 |
| `theme.ts` | 统一色表（尊重 `NO_COLOR`） |

---

## 三、逐模块施工单

### 模块 1 · `renderInkApp`

1. **路径**：`src/platform/terminal/ink/index.tsx`。
2. **职责**：接 `TerminalAppOptions` → 构造 `ConversationEngine` 依赖 →
   Ink render。
3. **依赖**：现有 `createTerminalAgentRuntime` / `createTerminalSession`
   （`agent-runtime.ts`），**不改它们**，只改调用方。
4. **改动方案**：

```tsx
// src/platform/terminal/ink/index.tsx
import { render } from 'ink';
import React from 'react';
import { App } from './app.js';

export async function renderInkApp(opts: InkAppOptions): Promise<void> {
    if (!process.stdout.isTTY) {
        throw new Error('renderInkApp requires a TTY');
    }
    const { waitUntilExit } = render(<App opts={opts} />);
    await waitUntilExit();
}
```

5. **不允许**：在 `renderInkApp` 里直接操作 stdout.write。

---

### 模块 2 · `App`

1. **路径**：`src/platform/terminal/ink/app.tsx`。
2. **职责**：组合顶层布局 + 订阅事件 + 传 context。

```tsx
// app.tsx
export function App({ opts }: { opts: InkAppOptions }) {
    const stream = useConversationStream(opts); // 自己管 session/runtime
    const history = useHistoryBuffer();
    const approval = useApprovalQueue(stream.events);

    return (
        <Box flexDirection="column">
            <StatusBar {...stream.status} />
            <Box flexGrow={1} flexDirection="column" overflow="hidden">
                <MessageList messages={stream.messages} />
            </Box>
            {approval.pending && <ApprovalDialog request={approval.pending} onResolve={approval.resolve} />}
            <PromptInput
                disabled={!!approval.pending}
                onSubmit={(t) => { history.push(t); stream.submit(t); }}
                onHistory={history.get}
            />
        </Box>
    );
}
```

3. **不允许**：在 App 里直接 `process.exit`。退出由 hook 抛 Ink 的
   `useApp().exit()`。

---

### 模块 3 · `useConversationStream`

1. **路径**：`hooks/useConversationStream.ts`。
2. **职责**：
   - 启动 `ConversationEngine`（通过现有
     `createTerminalAgentRuntime`）；
   - 订阅事件 → reduce 到 state；
   - 暴露 `submit(text)` / `cancel()`。

```ts
export function useConversationStream(opts: InkAppOptions) {
    const [state, dispatch] = useReducer(reduce, initialState);
    const runtimeRef = useRef<TerminalAgentRuntime>();

    useEffect(() => {
        (async () => {
            const runtime = await createTerminalAgentRuntime(opts);
            runtimeRef.current = runtime;
            for await (const env of runtime.events) {
                dispatch({ type: env.type, payload: env.payload });
            }
        })();
    }, []);

    const submit = useCallback((text: string) => {
        runtimeRef.current?.submit(text);
    }, []);

    return { ...state, submit };
}
```

3. **注意**：`reduce` 必须处理所有 ~12 种 `ConversationEvent` 类型。
4. **不允许**：在 reducer 里发起 I/O。

---

### 模块 4–8

与主 App 同构，按职责拆分即可。每个组件都是纯函数组件，仅接收 props。
**不在文档中罗列完整代码**（每个文件 < 100 行）；在施工时各自独立提交
PR，按 "输入输出 + 截图" 自验证。

---

### 模块 9 · 切换入口

1. **路径**：`src/platform/terminal/app/run-terminal-app.ts`。
2. **改动方案**：
```ts
export async function runTerminalApp(opts: TerminalAppOptions): Promise<void> {
    if (!opts.prompt && process.stdout.isTTY && process.env.XQODER_TUI !== 'classic') {
        const { renderInkApp } = await import('../ink/index.js');
        return renderInkApp({ ...opts });
    }
    // 现有 readline 路径保持不动
    return runLegacyTerminalApp(opts);
}
```

3. **注意**：动态 `import`，避免 headless 模式加载 Ink/React（冷启动开销）。
4. **回退**：`XQODER_TUI=classic` 一键退回旧 UI。

---

## 四、逐文件修改建议

见上。

## 五、数据结构与流程

```
render(<App />)
  └─ useConversationStream
      ├─ createTerminalAgentRuntime(opts) → runtime
      └─ for await env of runtime.events → dispatch(env)
         └─ state { status, messages, toolBlocks, thinkingBlocks, approvals }

User typing
  └─ PromptInput.onSubmit(text)
      └─ runtime.submit(text)  // 复用现有 chat runner
```

## 六、关键代码

见模块 1 / 2 / 3 内嵌代码块。

## 七、验证方案

### 手动测试

- `bun dist/index.js chat "hello" --dir .`，期望进入 Ink UI。
- 对 `run_shell` 调用，期望弹出审批（按 y 放行、n 拒绝、a 永久放行）。
- 按 ↑ 翻历史命令；按 Ctrl+C 退出。

### 边界测试

- 非 TTY（`bun dist/index.js chat ... | cat`）→ 自动降级到 classic。
- 极长 assistant 输出（10k tokens）→ MessageList 应能滚动而不是撑爆。
- 连续多条并发 toolCall（并发分批后）→ `ToolBlock` 列表独立刷新。
- 窗口 resize：Ink 自动处理；验收 `stdout.columns` 变化后布局 re-flow。

### 对比验证

- `XQODER_TUI=classic` 与默认 Ink 输出对比：文字内容一致，只有呈现不同。

### 失败判定

- 输入框 backspace / 方向键表现异常（Ink 的 `useInput` 未正确处理）。
- thinking 块默认全展开（应折叠）。
- ANSI 兼容：Windows cmd.exe 下 `NO_COLOR=1` 后仍输出颜色转义。

## 风险与回退

- **最大风险**：Ink 与项目 bun 打包的兼容性（`react-jsx` 配置 / `.tsx` 输出）。
  `scripts/build.mjs` 必须能产出 `.js` 而不报 JSX 错。施工前跑一次空 App
  的 smoke。
- **回退**：`XQODER_TUI=classic` 环境变量即回到旧 UI，无需部署。

## 不确定项

- Ink 6 对 bun runtime 的支持：部分 Ink 内部使用 Node 内建流。建议
  **先跑一个 10 行的 `Hello Ink` demo**（`src/platform/terminal/ink/smoke.tsx`）
  验证 bun 打包和运行都不炸，再启动完整开发。
- `tsconfig.json` 启用 `"jsx": "react-jsx"` 是否会污染其他目录：
  建议单独建 `tsconfig.platform-terminal-ink.json`，只 include Ink 目录。
