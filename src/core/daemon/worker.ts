// P25a — Daemon worker: runs in a child_process.fork context.
//
// Each worker owns one agent session. The supervisor spawns workers on demand.
// Workers communicate with the supervisor via process.send / process.on('message').

process.on('message', (msg: unknown) => {
    const m = msg as Record<string, unknown>;
    switch (m['type']) {
        case 'ping':
            process.send?.({ type: 'pong', pid: process.pid });
            break;
        case 'shutdown':
            process.exit(0);
            break;
        default:
            process.send?.({ type: 'error', error: `Unknown message type: ${m['type']}` });
    }
});

process.on('SIGTERM', () => {
    process.exit(0);
});

// Signal readiness
process.send?.({ type: 'ready', pid: process.pid, workerId: process.env['XQODER_WORKER_ID'] });
