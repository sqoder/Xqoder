// P06 — renderInkApp: entry point for the Ink REPL.
// Called by run-terminal-app.ts when in interactive TTY mode.

import { render } from 'ink';
import type { TuiAgentSettings } from '../../../application/agent/ports.js';
import type { TerminalAgentRuntime } from '../app/agent-runtime.js';
import { InkApp } from './app.js';

export interface RenderInkAppOptions {
    runtime: TerminalAgentRuntime;
    settings: TuiAgentSettings;
    initialSessionId?: string;
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WriteStream;
    stderr?: NodeJS.WriteStream;
}

/**
 * Render the Ink REPL and wait until the user exits.
 * Falls back gracefully if the terminal is not a TTY.
 */
export async function renderInkApp(options: RenderInkAppOptions): Promise<void> {
    const { runtime, settings, initialSessionId, stdin, stdout } = options;

    const { waitUntilExit } = render(
        <InkApp
            agentService={runtime.agentService}
            settings={settings}
            initialSessionId={initialSessionId}
        />,
        {
            stdin: stdin ?? process.stdin,
            stdout: stdout ?? process.stdout,
            exitOnCtrlC: true,
            patchConsole: true,
        },
    );

    await waitUntilExit();
}
