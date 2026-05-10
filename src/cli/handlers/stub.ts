// P10 fast-path stubs. Each handler prints "not implemented in this build" and
// exits with code 2. Real implementations land in later phases (daemon → P25,
// remote-control → P19, environment-runner → P20, chrome-* → P23).

import type { FastPathName } from '../fast-path.js';

export function createStub(feature: string, handlerName: FastPathName): (args: string[]) => Promise<void> {
    return async (_args: string[]) => {
        process.stderr.write(
            `xqoder: \`${feature}\` is not implemented in this build.\n` +
            `  Handler: ${handlerName}\n` +
            `  Enable via \`xqoder features enable <flag>\` once the phase lands.\n`,
        );
        process.exitCode = 2;
    };
}
