import stringWidth from 'string-width';

export interface TerminalSize {
    width: number;
    height: number;
}

export interface CellStyle {
    fg?: string;
    bg?: string;
    bold?: boolean;
    dim?: boolean;
    inverse?: boolean;
    underline?: boolean;
}

export interface ScreenCell {
    char: string;
    style: CellStyle;
    continuation?: boolean;
}

export interface ScreenPatch {
    x: number;
    y: number;
    text: string;
    style: CellStyle;
}

function cloneStyle(style: CellStyle): CellStyle {
    return { ...style };
}

function styleSignature(style: CellStyle): string {
    return JSON.stringify([
        style.fg ?? '',
        style.bg ?? '',
        style.bold ?? false,
        style.dim ?? false,
        style.inverse ?? false,
        style.underline ?? false,
    ]);
}

function sameStyle(left: CellStyle, right: CellStyle): boolean {
    return styleSignature(left) === styleSignature(right);
}

function createCell(style: CellStyle = {}): ScreenCell {
    return {
        char: ' ',
        style: cloneStyle(style),
        continuation: false,
    };
}

export class ScreenBuffer {
    readonly width: number;
    readonly height: number;
    private readonly cells: ScreenCell[];

    constructor(size: TerminalSize, fillStyle: CellStyle = {}) {
        this.width = Math.max(1, size.width);
        this.height = Math.max(1, size.height);
        this.cells = Array.from({ length: this.width * this.height }, () => createCell(fillStyle));
    }

    static empty(size: TerminalSize, fillStyle: CellStyle = {}): ScreenBuffer {
        return new ScreenBuffer(size, fillStyle);
    }

    clone(): ScreenBuffer {
        const copy = new ScreenBuffer({ width: this.width, height: this.height });
        for (let index = 0; index < this.cells.length; index += 1) {
            copy.cells[index] = {
                char: this.cells[index]!.char,
                style: cloneStyle(this.cells[index]!.style),
                continuation: this.cells[index]!.continuation,
            };
        }
        return copy;
    }

    clear(style: CellStyle = {}): void {
        for (let index = 0; index < this.cells.length; index += 1) {
            this.cells[index] = createCell(style);
        }
    }

    getCell(x: number, y: number): ScreenCell | undefined {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
            return undefined;
        }
        return this.cells[y * this.width + x];
    }

    setCell(x: number, y: number, char: string, style: CellStyle = {}): void {
        const cell = this.getCell(x, y);
        if (!cell) {
            return;
        }

        cell.char = char;
        cell.style = cloneStyle(style);
        cell.continuation = false;
    }

    setContinuationCell(x: number, y: number, style: CellStyle = {}): void {
        const cell = this.getCell(x, y);
        if (!cell) {
            return;
        }

        cell.char = '';
        cell.style = cloneStyle(style);
        cell.continuation = true;
    }

    writeText(x: number, y: number, text: string, style: CellStyle = {}): void {
        let cursorX = x;
        let cursorY = y;

        for (const char of text) {
            if (char === '\n') {
                cursorX = x;
                cursorY += 1;
                if (cursorY >= this.height) {
                    break;
                }
                continue;
            }

            const charWidth = Math.max(1, stringWidth(char));
            if (cursorX + charWidth > this.width) {
                cursorX = x;
                cursorY += 1;
            }
            if (cursorY >= this.height) {
                break;
            }

            this.setCell(cursorX, cursorY, char, style);
            for (let offset = 1; offset < charWidth; offset += 1) {
                this.setContinuationCell(cursorX + offset, cursorY, style);
            }
            cursorX += charWidth;
        }
    }

    /** 用指定样式填充矩形区域（空格），用于阴影/色块效果 */
    fillRect(x: number, y: number, width: number, height: number, style: CellStyle = {}): void {
        const xEnd = Math.min(this.width, x + width);
        const yEnd = Math.min(this.height, y + height);
        for (let row = Math.max(0, y); row < yEnd; row += 1) {
            for (let col = Math.max(0, x); col < xEnd; col += 1) {
                this.setCell(col, row, ' ', style);
            }
        }
    }

    drawHorizontalLine(x: number, y: number, width: number, char = '─', style: CellStyle = {}): void {
        for (let offset = 0; offset < width; offset += 1) {
            this.setCell(x + offset, y, char, style);
        }
    }

    drawVerticalLine(x: number, y: number, height: number, char = '│', style: CellStyle = {}): void {
        for (let offset = 0; offset < height; offset += 1) {
            this.setCell(x, y + offset, char, style);
        }
    }

    drawBox(x: number, y: number, width: number, height: number, style: CellStyle = {}): void {
        if (width < 2 || height < 2) {
            return;
        }

        this.setCell(x, y, '┌', style);
        this.setCell(x + width - 1, y, '┐', style);
        this.setCell(x, y + height - 1, '└', style);
        this.setCell(x + width - 1, y + height - 1, '┘', style);
        this.drawHorizontalLine(x + 1, y, width - 2, '─', style);
        this.drawHorizontalLine(x + 1, y + height - 1, width - 2, '─', style);
        this.drawVerticalLine(x, y + 1, height - 2, '│', style);
        this.drawVerticalLine(x + width - 1, y + 1, height - 2, '│', style);
    }

    toLines(): string[] {
        return Array.from({ length: this.height }, (_, rowIndex) => {
            const start = rowIndex * this.width;
            const end = start + this.width;
            return this.cells.slice(start, end).map((cell) => cell.continuation ? '' : cell.char).join('');
        });
    }

    diff(next: ScreenBuffer): ScreenPatch[] {
        if (this.width !== next.width || this.height !== next.height) {
            return next.toLines().map((line, index) => ({
                x: 0,
                y: index,
                text: line,
                style: {},
            }));
        }

        const patches: ScreenPatch[] = [];
        for (let y = 0; y < this.height; y += 1) {
            let runStart = -1;
            let runText = '';
            let runStyle: CellStyle | null = null;

            const flush = (): void => {
                if (runStart === -1 || runStyle === null || runText.length === 0) {
                    return;
                }
                patches.push({ x: runStart, y, text: runText, style: runStyle });
                runStart = -1;
                runText = '';
                runStyle = null;
            };

            for (let x = 0; x < this.width; x += 1) {
                const current = this.getCell(x, y)!;
                const target = next.getCell(x, y)!;
                const changed = current.char !== target.char || !sameStyle(current.style, target.style);
                if (!changed) {
                    flush();
                    continue;
                }

                if (runStart === -1) {
                    runStart = x;
                    runText = target.continuation ? '' : target.char;
                    runStyle = cloneStyle(target.style);
                    continue;
                }

                if (runStyle && sameStyle(runStyle, target.style)) {
                    runText += target.continuation ? '' : target.char;
                } else {
                    flush();
                    runStart = x;
                    runText = target.continuation ? '' : target.char;
                    runStyle = cloneStyle(target.style);
                }
            }

            flush();
        }

        return patches;
    }
}
