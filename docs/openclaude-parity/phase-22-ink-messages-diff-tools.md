# Phase 22 · Ink 消息 / diff / 工具块组件

## 任务目标（必须可验证）

phase-06 搭了 Ink 骨架；本期把 `components/messages/**`、`components/diff/**`、
`components/StructuredDiff/**`、`components/PromptInput/**` 的关键组件全部实装。

## 对标源（节选）

- `openclaude/src/components/Message.tsx`
- `openclaude/src/components/Messages.tsx`
- `openclaude/src/components/MessageRow.tsx`
- `openclaude/src/components/MessageResponse.tsx`
- `openclaude/src/components/MessageTimestamp.tsx`
- `openclaude/src/components/Markdown.tsx`
- `openclaude/src/components/HighlightedCode.tsx`
- `openclaude/src/components/StructuredDiff.tsx / StructuredDiffList.tsx`
- `openclaude/src/components/diff/**`
- `openclaude/src/components/FileEditToolDiff.tsx`
- `openclaude/src/components/FileEditToolUpdatedMessage.tsx`
- `openclaude/src/components/FileEditToolUseRejectedMessage.tsx`
- `openclaude/src/components/ToolUseLoader.tsx`
- `openclaude/src/components/Spinner.tsx`
- `openclaude/src/components/PromptInput/**`
- `openclaude/src/components/VirtualMessageList.tsx`
- `openclaude/src/components/messages/**`
- `openclaude/src/components/Markdown.tsx`
- `openclaude/src/ink/**`（47 文件，是自定义 renderer；复刻时用依赖形式 `ink@6`）

### 成功判定

- 聊天流：user 消息（实线框 + "You"）、assistant 消息（流式光标 + "Claude"）
  正确渲染。
- Markdown：标题、列表、代码块、围栏块被 `chalk` 高亮。
- 代码块：`HighlightedCode` 按语言做语法高亮（用 `highlight.js` 这里不引入，
  v1 只做最小关键字上色）。
- 文件编辑工具：显示 diff（绿色 +；红色 −）+ 行号 + 文件名标题。
- 长对话：`VirtualMessageList` 支持滚动 + viewport 只渲染可见区。
- Prompt input：多行、方向键、历史翻回、粘贴图片、`@file` 高亮。
- status bar：provider / model / token usage / cost / mode。

## 范围与边界

### 允许修改

- 新增 `src/platform/terminal/ink/components/**`：
  - `messages/MessageList.tsx`
  - `messages/UserMessage.tsx`
  - `messages/AssistantMessage.tsx`
  - `messages/ThinkingBlock.tsx`
  - `messages/MessageTimestamp.tsx`
  - `markdown/Markdown.tsx`
  - `markdown/HighlightedCode.tsx`
  - `diff/FileDiff.tsx`
  - `diff/StructuredDiff.tsx`
  - `tools/ToolBlock.tsx`
  - `tools/ToolUseLoader.tsx`
  - `input/PromptInput.tsx`
  - `input/TextInput.tsx`
  - `chrome/StatusBar.tsx`
  - `chrome/Spinner.tsx`
- 新增 `src/platform/terminal/ink/hooks/**`：
  - `useVirtualScroll.ts`
  - `usePasteHandler.ts`
  - `useTextInput.ts`
  - `useArrowKeyHistory.ts`
- 升级 `src/platform/terminal/ink/app.tsx` 组合这些。

### 禁止修改

- Ink 底层（我们用 npm 依赖，不 fork 47 个文件）。
- `ConversationEventEnvelope` 事件协议。

## 改动要点

### 1) Markdown 最小实现

```tsx
export function Markdown({ text }: { text: string }) {
    const ast = parseMarkdown(text);
    return <>{ast.map(renderNode)}</>;
}
```

节点类型：`heading / paragraph / list / codeBlock / codeFence / inlineCode / strong / em`。
不支持 table / image（终端里本来也不好渲染）。

### 2) FileDiff

用 `diff` 算法（自己实现 LCS，小，~80 行；或用 Node 内置无依赖方式）。
视觉：
```
  src/foo.ts
  ├─ line 10..14
- -   return x;
+ +   return x + 1;
```

### 3) VirtualMessageList

```tsx
export function VirtualMessageList({ messages }) {
    const [topIdx, bottomIdx] = useVirtualScroll(messages.length, terminalRows);
    return <Box flexDirection="column">
        {messages.slice(topIdx, bottomIdx).map(m => <MessageRow key={m.id} message={m} />)}
    </Box>;
}
```

`useVirtualScroll` 只保留当前 viewport 的消息在 DOM 里渲染，避免 Ink
重算整棵树。

### 4) PromptInput

```tsx
<Box borderStyle="round" paddingX={1}>
    <TextInput value={text} onChange={setText} onSubmit={onSubmit}
               historyHook={useArrowKeyHistory}
               mentionsHook={useMentionExpand} />
</Box>
```

### 5) StatusBar

```tsx
<Box justifyContent="space-between">
    <Text dimColor>{provider}/{model}</Text>
    <Text>{mode.symbol} {mode.shortTitle}</Text>
    <Text dimColor>{formatTokens(usage.totalTokens)} · ${usage.cost.toFixed(3)}</Text>
</Box>
```

## 验证

- 视觉 snapshot 测试（`ink-testing-library`）。
- 手动 e2e：长对话滚动不卡；backspace / ↑↓ 正常；粘贴图片触发 attach。

## 风险与回退

- **风险**：Ink 在 bun 下与 React 19 的 Suspense 语义在部分终端偶发刷新问题。
  **缓解**：VirtualMessageList 禁用 Suspense；使用 `useTransition` 低优先级
  更新流式 token。
- **回退**：classic 模式（phase-06 已留开关）。

## 不确定项

- OpenClaude 的代码高亮用自制 ANSI 高亮器（47 个 ink 文件之一）。v1 用最小
  关键字上色；v2 可接 `shiki` 或 `chalk-highlight`。
