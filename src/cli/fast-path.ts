// P10: fast-path detector — maps argv to a handler name, or undefined if the
// invocation should proceed to the full commander / Ink program.
//
// Handler names map 1:1 to files under `src/cli/handlers/`.

export type FastPathName =
    | 'dump-system-prompt'
    | 'daemon'
    | 'daemon-worker'
    | 'ps'
    | 'logs'
    | 'attach'
    | 'kill'
    | 'remote-control'
    | 'rc-new'
    | 'rc-list'
    | 'rc-reply'
    | 'environment-runner'
    | 'self-hosted-runner'
    | 'claude-in-chrome-mcp'
    | 'chrome-native-host'
    | 'computer-use-mcp'
    | 'worktree';

const BARE_SUBCOMMAND_HANDLERS: Record<string, FastPathName> = {
    daemon: 'daemon',
    ps: 'ps',
    logs: 'logs',
    attach: 'attach',
    kill: 'kill',
    'remote-control': 'remote-control',
    rc: 'remote-control',
};

const LONG_FLAG_HANDLERS: Record<string, FastPathName> = {
    '--dump-system-prompt': 'dump-system-prompt',
    '--daemon-worker': 'daemon-worker',
    '--environment-runner': 'environment-runner',
    '--self-hosted-runner': 'self-hosted-runner',
    '--claude-in-chrome-mcp': 'claude-in-chrome-mcp',
    '--chrome-native-host': 'chrome-native-host',
    '--computer-use-mcp': 'computer-use-mcp',
};

// `xqoder rc new|list|reply ...` also maps to fast-path handlers. The main
// `rc` subcommand without a sub-verb falls back to the generic remote-control
// stub.
const RC_SUBVERB_HANDLERS: Record<string, FastPathName> = {
    new: 'rc-new',
    list: 'rc-list',
    reply: 'rc-reply',
};

export interface FastPathDetection {
    readonly handler: FastPathName;
    readonly trigger: string;
}

export function detectFastPath(args: string[]): FastPathDetection | undefined {
    for (const arg of args) {
        if (typeof arg !== 'string') {
            continue;
        }
        const handler = LONG_FLAG_HANDLERS[arg];
        if (handler) {
            return { handler, trigger: arg };
        }
    }

    const first = args.find((candidate) => candidate && !candidate.startsWith('-'));
    if (!first) {
        return undefined;
    }

    if (first === 'rc' || first === 'remote-control') {
        const rest = args.slice(args.indexOf(first) + 1).find((candidate) => candidate && !candidate.startsWith('-'));
        if (rest && RC_SUBVERB_HANDLERS[rest]) {
            return { handler: RC_SUBVERB_HANDLERS[rest]!, trigger: `${first} ${rest}` };
        }
        return { handler: 'remote-control', trigger: first };
    }

    if (BARE_SUBCOMMAND_HANDLERS[first]) {
        return { handler: BARE_SUBCOMMAND_HANDLERS[first]!, trigger: first };
    }

    // `--worktree <path> --tmux` is passed as option to the root shell; it's
    // not itself a fast-path — the root shell dispatches it. Keep that path in
    // the full program so the handler map stays focused.
    return undefined;
}
