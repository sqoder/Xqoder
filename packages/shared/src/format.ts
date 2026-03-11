// ============================================================
// Output Format — 非交互模式输出格式化
// 参考 OpenCode: internal/format/format.go
// ============================================================

export type OutputFormat = 'text' | 'json';

export interface FormatOptions {
    format: OutputFormat;
    quiet?: boolean;
}

/**
 * Format a response for non-interactive output.
 */
export function formatOutput(response: string, options: FormatOptions): string {
    switch (options.format) {
        case 'json':
            return JSON.stringify({ response }, null, 2);
        case 'text':
        default:
            return response;
    }
}

/**
 * Simple spinner for non-interactive mode.
 * Returns a stopper function.
 */
export function createSpinner(message = 'Thinking...'): { stop: (finalMessage?: string) => void } {
    const frames = ['◐', '◓', '◑', '◒'];
    let frameIndex = 0;
    let stopped = false;

    const interval = setInterval(() => {
        if (stopped) return;
        process.stderr.write(`\r${frames[frameIndex % frames.length]} ${message}`);
        frameIndex++;
    }, 120);

    return {
        stop(finalMessage?: string) {
            stopped = true;
            clearInterval(interval);
            process.stderr.write('\r' + ' '.repeat(message.length + 3) + '\r');
            if (finalMessage) {
                process.stderr.write(finalMessage + '\n');
            }
        },
    };
}
