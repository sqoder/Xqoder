// P21b — Cross-platform "open this URL in the user's default browser" helper.
//
// Thin wrapper around platform-specific commands. Non-blocking: spawns and
// returns immediately, does not wait for the browser to exit. Caller must
// handle failure (e.g. headless) by falling back to printing the URL.

import { spawn } from 'node:child_process';

export interface OpenBrowserOptions {
    /** Test seam: override child_process.spawn. */
    readonly spawnImpl?: typeof spawn;
    /** Override platform (defaults to process.platform). */
    readonly platform?: NodeJS.Platform;
}

export function openBrowser(url: string, options: OpenBrowserOptions = {}): boolean {
    const spawnFn = options.spawnImpl ?? spawn;
    const platform = options.platform ?? process.platform;
    try {
        let cmd: string;
        let args: string[];
        if (platform === 'darwin') {
            cmd = 'open';
            args = [url];
        } else if (platform === 'win32') {
            cmd = 'cmd';
            args = ['/c', 'start', '""', url.replace(/&/g, '^&')];
        } else {
            // linux / freebsd / openbsd / etc: xdg-open is near-universal
            cmd = 'xdg-open';
            args = [url];
        }
        const child = spawnFn(cmd, args, { detached: true, stdio: 'ignore' });
        child.unref?.();
        return true;
    } catch {
        return false;
    }
}
