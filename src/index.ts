#!/usr/bin/env node

process.env.NODE_NO_WARNINGS ??= '1';
process.noDeprecation = true;

// Prevent SIGPIPE from killing the process (broken pipes under pnpm/tmux)
try { process.on('SIGPIPE', () => { /* ignore */ }); } catch { /* no SIGPIPE on this platform */ }

// Global stream error handlers — must be installed BEFORE any I/O
process.stdin.on('error', () => { /* swallow read EIO/EPIPE */ });
process.stdout.on('error', () => { /* swallow write EIO/EPIPE */ });
process.stderr.on('error', () => { /* swallow write EIO/EPIPE */ });

try {
    const { runCliMain } = await import('./bootstrap/cli-main.js');
    await runCliMain(process.argv);
} catch (err) {
    // Lifecycle interruption: provide clear feedback when program exits unexpectedly
    try {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[XQoder] Unexpected exit: ${msg}\n`);
    } catch { /* stderr might be broken too */ }
    process.exitCode = 1;
}

export {};
