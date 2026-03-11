#!/usr/bin/env node

process.env.NODE_NO_WARNINGS ??= '1';
process.noDeprecation = true;

// Prevent SIGPIPE from killing the process (broken pipes under pnpm/tmux)
try { process.on('SIGPIPE', () => { /* ignore */ }); } catch { /* no SIGPIPE on this platform */ }

// Global stream error handlers — must be installed BEFORE any I/O
process.stdin.on('error', () => { /* swallow read EIO/EPIPE */ });
process.stdout.on('error', () => { /* swallow write EIO/EPIPE */ });
process.stderr.on('error', () => { /* swallow write EIO/EPIPE */ });

if (process.stdout.isTTY && shouldClearBeforeLaunch(process.argv)) {
    try { console.clear(); } catch { /* ignore */ }
}

try {
    const { runProgram } = await import('./program.js');
    await runProgram(process.argv);
} catch (err) {
    // 生命周期中断：程序异常退出时给出明确提示
    try {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[XQoder] 异常退出: ${msg}\n`);
    } catch { /* stderr might be broken too */ }
    process.exitCode = 1;
}

function shouldClearBeforeLaunch(argv: string[]): boolean {
    const args = argv.slice(2).filter(a => a !== '--');
    return args.length === 0 || args[0] === 'tui';
}
