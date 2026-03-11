import type { TerminalWriter, TerminalRenderResult } from './types.js';
import type { CellStyle } from './screen-buffer.js';

function styleToAnsi(style: CellStyle): string {
    const codes: string[] = [];
    if (style.bold) codes.push('1');
    if (style.dim) codes.push('2');
    if (style.underline) codes.push('4');
    if (style.inverse) codes.push('7');
    return codes.length > 0 ? `\x1b[${codes.join(';')}m` : '';
}

export class AnsiPatchWriter implements TerminalWriter {
    constructor(private readonly stdout: NodeJS.WriteStream) {}

    write(result: TerminalRenderResult): void {
        if (result.fullRedraw) {
            this.stdout.write('\x1b[H\x1b[2J');
        }

        const width = result.buffer.width;
        const height = result.buffer.height;
        for (const patch of result.patches) {
            if (patch.y >= height || patch.x >= width) continue;
            const maxLen = Math.max(0, width - patch.x);
            const text = patch.text.slice(0, maxLen);
            if (text.length === 0) continue;
            const move = `\x1b[${patch.y + 1};${patch.x + 1}H`;
            const style = styleToAnsi(patch.style);
            this.stdout.write(`${move}${style}${text}\x1b[0m`);
        }

        if (result.cursor) {
            this.stdout.write(`\x1b[${result.cursor.y + 1};${result.cursor.x + 1}H`);
            this.stdout.write(result.cursor.visible === false ? '\x1b[?25l' : '\x1b[?25h\x1b[5 q');
        }
    }
}
