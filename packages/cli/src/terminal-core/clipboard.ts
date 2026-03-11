import clipboardy from 'clipboardy';

/**
 * 写入系统剪贴板。使用 clipboardy，支持 macOS / Windows / Linux。
 * 失败时静默忽略（无 GUI 环境或权限不足）。
 */
export function writeToClipboard(text: string): boolean {
    try {
        clipboardy.writeSync(text);
        return true;
    } catch {
        return false;
    }
}
