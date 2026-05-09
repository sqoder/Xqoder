# Phase 23 · 键绑定 / Vim / 历史 / 全局 shortcut

## 任务目标（必须可验证）

实现 OpenClaude `keybindings/**` + `vim/**` + 若干 hook 的终端交互能力。

## 对标源

- `openclaude/src/keybindings/defaultBindings.ts`
- `openclaude/src/keybindings/KeybindingContext.tsx`
- `openclaude/src/keybindings/loadUserBindings.ts`
- `openclaude/src/keybindings/match.ts / parser.ts / resolver.ts / schema.ts / shortcutFormat.ts / template.ts / validate.ts`
- `openclaude/src/vim/motions.ts / operators.ts / textObjects.ts / transitions.ts / types.ts`
- `openclaude/src/hooks/useVimInput.ts`
- `openclaude/src/hooks/useArrowKeyHistory.tsx`
- `openclaude/src/hooks/useGlobalKeybindings.tsx`
- `openclaude/src/hooks/useCommandKeybindings.tsx`
- `openclaude/src/hooks/useHistorySearch.ts`
- `openclaude/src/components/HistorySearchDialog.tsx`
- `openclaude/src/components/KeybindingWarnings.tsx`

### 成功判定

- 默认 keybindings：
  - Ctrl+C：cancel 当前 turn
  - Ctrl+D：exit
  - Ctrl+R：history search
  - Ctrl+L：clear scrollback
  - Ctrl+K：打开 command palette
  - Ctrl+Shift+C：copy last response
  - Shift+Tab：切 permission mode
  - Tab：自动完成 / thinking 展开
  - Esc：interrupt / vim mode 切换
- `~/.xqoder/keybindings.json` 可覆盖。
- Vim 模式：`/vim on` 切换后，PromptInput 支持 i / esc / yy / dd / hjkl /
  w / b / v / y / p 最小集。
- History search：Ctrl+R 打开 fuzzy search 弹窗。

## 范围与边界

### 允许修改

- 新增 `src/platform/terminal/ink/keybindings/`:
  - `defaults.ts`
  - `load-user.ts`
  - `match.ts`
  - `context.tsx`
- 新增 `src/platform/terminal/ink/vim/`（最小集）:
  - `motions.ts`
  - `operators.ts`
  - `state.ts`
  - `transitions.ts`
- 新增 `src/platform/terminal/ink/components/HistorySearchDialog.tsx`。
- 新增 `src/platform/terminal/ink/hooks/use*.ts`。

### 禁止修改

- 其它层的行为（完全 UI 层）。

## 改动要点

### 1) Keybinding schema

```ts
interface Keybinding {
    id: string;
    keys: string[]; // eg 'ctrl+c'
    command: string; // eg 'cancel'
    when?: string; // 条件：context 表达式
}
```

默认绑定 20+ 条，见 OpenClaude `defaultBindings.ts` 逐条翻译到本仓。

### 2) Match

`Ink useInput((input, key)) => void` 已经提供键事件。把事件映射到 `keys`
字符串再查 registry：

```ts
export function matchKeys(event: KeyEvent): string[] {
    const parts: string[] = [];
    if (event.ctrl) parts.push('ctrl');
    if (event.shift) parts.push('shift');
    if (event.meta) parts.push('meta');
    if (event.name) parts.push(event.name);
    else parts.push(event.sequence);
    return [parts.join('+')];
}
```

### 3) Vim 最小集

- 状态机：`normal / insert / visual`
- motions：`h j k l w b e 0 $ gg G`
- operators：`y p d c i I a A o O`
- text objects：`iw iW i" i'`（最小）
- ESC 回到 normal；i 进 insert。

### 4) History search

```tsx
<HistorySearchDialog
    items={history}
    query={query}
    onSelect={(text) => { setInput(text); close(); }}
    onCancel={close}
/>
```

fuzzy 匹配用 minimum edit distance（小实现，≤ 60 行）。

## 验证

- Unit：`matchKeys` 30 条组合；`vim motions` fixture；history search
  relevance 排序断言。
- e2e：Ctrl+R → type 关键词 → 回车 → prompt 填入历史项。

## 风险与回退

- **风险**：Terminal 不支持某些键组合（Win cmd.exe 对 Ctrl+Shift+X 转义不一）。
  **缓解**：文档里标注已知限制；允许用户在 `keybindings.json` 自定义。
- **回退**：`XQODER_DISABLE_VIM=1` 关 vim，只走默认 insert 模式。

## 不确定项

- OpenClaude 的 Vim 实现覆盖面极广（含 `textObjects.ts / operators.ts`
  完整集）。本期 v1 只做 30% 最常用子集；足够 80% 用户的日常输入场景。
