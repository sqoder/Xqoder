import type { TerminalAppState } from './app-state.js';
import type { ClipboardService } from './clipboard.js';
import { writeToClipboardOSC52 } from './clipboard.js';
import type { TerminalCoreEvent } from './types.js';
import { getTranscriptHeight } from './runtime-bridge.js';

/**
 * 模块 2：复制目标（当前先做整块，后续可扩展选区）
 */
export type CopyTarget =
  | { kind: 'code-block'; blockId: string }
  | { kind: 'message'; messageId: string }
  | { kind: 'message-latest-assistant' };

/** 去掉每行行尾和整段末尾的空白（含 \\r、\\t、全角空格等），复制时不带留白 */
function trimTrailingWhitespace(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  return normalized
    .split('\n')
    .map((line) => line.replace(/\s+$/u, ''))
    .join('\n')
    .trimEnd();
}

/**
 * 从 state 解析出要复制的纯文本（rawText，不要带 markdown/ANSI 的显示文本）。
 */
export function resolveCopyText(state: TerminalAppState, target: CopyTarget): string | null {
  switch (target.kind) {
    case 'code-block': {
      const block = state.transcriptCodeBlocks.find((b) => b.id === target.blockId);
      return block ? block.text : null;
    }
    case 'message': {
      const entry = state.transcriptEntries.find((e) => e.id === target.messageId);
      return entry ? entry.content : null;
    }
    case 'message-latest-assistant': {
      const last = [...state.transcriptEntries]
        .reverse()
        .find((e) => e.role === 'assistant');
      return last ? last.content : null;
    }
    default:
      return null;
  }
}

/**
 * 模块 3：统一复制入口
 * 解析文本 -> 写剪贴板（OSC52 + 可选 clipboardy）-> 成功则更新 UI。
 * 对齐 OpenCode：优先用 OSC52 让终端写入剪贴板，SSH/无 pbcopy 时仍可复制。
 */
export async function copyTarget(
  state: TerminalAppState,
  target: CopyTarget,
  clipboard: ClipboardService,
  dispatch: (event: TerminalCoreEvent) => void,
  osc52Stream?: NodeJS.WritableStream,
): Promise<boolean> {
  const raw = resolveCopyText(state, target);
  if (raw == null || raw.length === 0) return false;
  const text = trimTrailingWhitespace(raw);
  if (text.length === 0) return false;
  const toastId = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ttl = 5000;
  if (osc52Stream) {
    writeToClipboardOSC52(text, osc52Stream);
  }
  try {
    await clipboard.writeText(text);
  } catch {
    if (!osc52Stream) {
      const errToastId = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      dispatch({
        type: 'toast.push',
        id: errToastId,
        text: 'Copy failed',
        kind: 'error',
        ttl: 2000,
      });
      setTimeout(() => dispatch({ type: 'toast.dismiss', id: errToastId }), 2000);
      return false;
    }
  }
  dispatch({
    type: 'toast.push',
    id: toastId,
    text: 'Copied to clipboard',
    kind: 'success',
    ttl,
  });
  if (target.kind === 'code-block') {
    dispatch({ type: 'copy.code-block', blockId: target.blockId });
  }
  setTimeout(() => {
    dispatch({ type: 'toast.dismiss', id: toastId });
    if (target.kind === 'code-block') {
      dispatch({ type: 'copy.code-block.clear' });
    }
  }, ttl);
  return true;
}

/**
 * 取当前视口内第一个代码块，用于快捷键 Alt+C / Ctrl+Shift+C。
 */
export function getFirstVisibleCodeBlockTarget(state: TerminalAppState): CopyTarget | null {
  const th = getTranscriptHeight(state);
  const first = state.viewport.topLine;
  const last = first + th - 1;
  const block = state.transcriptCodeBlocks.find(
    (b) => b.startLine <= last && b.endLine >= first,
  );
  return block ? { kind: 'code-block', blockId: block.id } : null;
}

/**
 * 根据「光标所在行」解析出要复制的片段（对齐 OpenCode：拖到哪段复制哪段）。
 * 先匹配代码块，否则匹配消息整条。
 */
export function getCopyTargetAtLine(state: TerminalAppState, lineIndex: number): CopyTarget | null {
  if (lineIndex < 0 || lineIndex >= state.transcriptLines.length) return null;
  const block = state.transcriptCodeBlocks.find(
    (b) => b.startLine <= lineIndex && b.endLine >= lineIndex,
  );
  if (block) return { kind: 'code-block', blockId: block.id };
  const range = state.transcriptEntryLineRanges.find(
    (r) => r.startLine <= lineIndex && r.endLine >= lineIndex,
  );
  if (range) return { kind: 'message', messageId: range.entryId };
  return null;
}
