// P10: fast-path dispatcher.
//
// Runs BEFORE any Ink / commander / plugin discovery import. Goal: zero-overhead
// paths for `--version`, `--dump-system-prompt`, `daemon`, and friends so
// startup latency stays close to Bun's cold-start floor.

import { applyProviderFlagFromArgs, applyModelFlagFromArgs } from '../cli/provider-flag.js';
import { detectFastPath, type FastPathName } from '../cli/fast-path.js';
import { feature, enableConfigs } from '../shared/feature-flags.js';

const FEATURE_GATE: Partial<Record<FastPathName, string>> = {
    'dump-system-prompt': 'DUMP_SYSTEM_PROMPT',
    daemon: 'DAEMON',
    'daemon-worker': 'DAEMON',
    ps: 'BG_SESSIONS',
    logs: 'BG_SESSIONS',
    attach: 'BG_SESSIONS',
    kill: 'BG_SESSIONS',
    'remote-control': 'BRIDGE_MODE',
    'rc-new': 'BRIDGE_MODE',
    'rc-list': 'BRIDGE_MODE',
    'rc-reply': 'BRIDGE_MODE',
    'environment-runner': 'COORDINATOR_MODE',
    'self-hosted-runner': 'COORDINATOR_MODE',
    'claude-in-chrome-mcp': 'CHICAGO_MCP',
    'chrome-native-host': 'CHICAGO_MCP',
    'computer-use-mcp': 'CHICAGO_MCP',
};

export async function runCliMain(argv: string[] = process.argv): Promise<void> {
    const args = argv.slice(2);

    // Fast-path: --version / -v with nothing else. No imports beyond version.
    if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
        const { getXQoderVersion } = await import('../cli/version.js');
        process.stdout.write(`${getXQoderVersion()} (xqoder)\n`);
        return;
    }

    // --provider / --model need env injection before any config loads. Order
    // matters: --provider also handles --model, so apply --model only when
    // --provider is absent.
    if (args.includes('--provider')) {
        const outcome = applyProviderFlagFromArgs(args);
        if (outcome?.error) {
            process.stderr.write(`${outcome.error}\n`);
            process.exitCode = 1;
            return;
        }
    } else if (args.includes('--model')) {
        applyModelFlagFromArgs(args);
    }

    enableConfigs();

    const detection = detectFastPath(args);
    if (detection) {
        const gate = FEATURE_GATE[detection.handler];
        if (gate && !feature(gate)) {
            process.stderr.write(
                `xqoder: \`${detection.trigger}\` is gated behind feature ${gate} (currently disabled).\n` +
                `  Enable with: xqoder features enable ${gate}\n`,
            );
            process.exitCode = 2;
            return;
        }
        const mod = await importHandler(detection.handler);
        await mod.run(args);
        return;
    }

    // Default: full CLI program.
    const { createXQoderEntrypoints } = await import('./compose.js');
    const entrypoints = createXQoderEntrypoints();
    await entrypoints.runCli(argv);
}

async function importHandler(name: FastPathName): Promise<{ run: (args: string[]) => Promise<void> }> {
    switch (name) {
        case 'dump-system-prompt':
            return import('../cli/handlers/dump-system-prompt.js');
        case 'daemon':
            return import('../cli/handlers/daemon.js');
        case 'daemon-worker':
            return import('../cli/handlers/daemon-worker.js');
        case 'ps':
            return import('../cli/handlers/ps.js');
        case 'logs':
            return import('../cli/handlers/logs.js');
        case 'attach':
            return import('../cli/handlers/attach.js');
        case 'kill':
            return import('../cli/handlers/kill.js');
        case 'remote-control':
            return import('../cli/handlers/remote-control.js');
        case 'rc-new':
            return import('../cli/handlers/rc-new.js');
        case 'rc-list':
            return import('../cli/handlers/rc-list.js');
        case 'rc-reply':
            return import('../cli/handlers/rc-reply.js');
        case 'environment-runner':
            return import('../cli/handlers/environment-runner.js');
        case 'self-hosted-runner':
            return import('../cli/handlers/self-hosted-runner.js');
        case 'claude-in-chrome-mcp':
            return import('../cli/handlers/claude-in-chrome-mcp.js');
        case 'chrome-native-host':
            return import('../cli/handlers/chrome-native-host.js');
        case 'computer-use-mcp':
            return import('../cli/handlers/computer-use-mcp.js');
        case 'worktree':
            return import('../cli/handlers/worktree.js');
    }
}
