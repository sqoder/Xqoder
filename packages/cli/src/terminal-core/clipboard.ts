import clipboardy from 'clipboardy';

/**
 * OSC52：通过终端转义序列让终端模拟器把内容写入系统剪贴板（对齐 OpenCode）。
 * 格式：ESC ] 52 ; c ; <base64> BEL。支持 iTerm2、WezTerm、Alacritty、Windows Terminal 等。
 * 在 SSH/无 pbcopy 环境下仍可复制。
 */
export function writeToClipboardOSC52(text: string, out: NodeJS.WritableStream): void {
  try {
    const base64 = Buffer.from(text, 'utf8').toString('base64');
    const seq = `\u001b]52;c;${base64}\u0007`;
    out.write(seq);
  } catch {
    // 忽略编码/写入错误
  }
}

/**
 * 模块 1：Clipboard Service
 * 只负责与系统剪贴板交互，不关心 UI。
 */
export interface ClipboardService {
  writeText(text: string): Promise<void>;
  readText?(): Promise<string>;
}

function createClipboardyService(): ClipboardService {
  return {
    writeText(text: string): Promise<void> {
      try {
        clipboardy.writeSync(text);
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e);
      }
    },
    readText(): Promise<string> {
      try {
        const s = clipboardy.readSync();
        return Promise.resolve(s ?? '');
      } catch (e) {
        return Promise.reject(e);
      }
    },
  };
}

let defaultInstance: ClipboardService | null = null;

export function getClipboardService(): ClipboardService {
  if (defaultInstance === null) {
    defaultInstance = createClipboardyService();
  }
  return defaultInstance;
}

/**
 * 同步写入，供现有调用方兼容。失败返回 false。
 * 新代码请用 getClipboardService().writeText()。
 */
export function writeToClipboard(text: string): boolean {
  try {
    clipboardy.writeSync(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 同步从剪贴板读取，供 Ctrl+V 粘贴使用。失败返回空字符串。
 */
export function readFromClipboard(): string {
  try {
    return clipboardy.readSync() ?? '';
  } catch {
    return '';
  }
}
