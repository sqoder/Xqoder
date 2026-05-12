export interface ShellPattern {
    re: RegExp;
    reason: string;
}

export const DANGEROUS_PATTERNS: ShellPattern[] = [
    { re: /\bsudo\b/, reason: 'elevates privileges via sudo' },
    { re: /\bsu\s+-\b/, reason: 'switches user via `su -`' },
    { re: /\brm\s+-[rRf]{1,2}\s+\/(?![A-Za-z0-9._/-]*workspaces)/, reason: 'recursive delete outside workspace' },
    { re: /\brm\s+-[rRf]{1,2}\s+~\/?\s*$/, reason: 'wipes home directory' },
    { re: /\bmkfs\b/, reason: 'formats a filesystem' },
    { re: /\bshutdown\b/, reason: 'shuts down the system' },
    { re: /\breboot\b/, reason: 'reboots the system' },
    { re: /\bhalt\b/, reason: 'halts the system' },
    { re: /\bpoweroff\b/, reason: 'powers off the system' },
    { re: /\bdd\b[^|]*\bof=\/dev\//, reason: 'raw disk write to /dev/*' },
    { re: />\s*\/dev\/(sd|nvme|disk|hd)/, reason: 'redirect into raw block device' },
    { re: /:\s*\(\s*\)\s*\{\s*:\s*\|:&\s*}\s*;\s*:/, reason: 'fork bomb' },
    { re: /\bchmod\s+-[Rr]{1,2}\s+\//, reason: 'recursive chmod from root' },
    { re: /\bchown\s+-[Rr]{1,2}\s+\//, reason: 'recursive chown from root' },
    { re: /\bcurl\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z|sh|dash|fish)?sh\b/, reason: 'pipes remote script into shell' },
    { re: /\bwget\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z|sh|dash|fish)?sh\b/, reason: 'pipes remote script into shell' },
    { re: /\beval\s+\$\(\s*curl\b/, reason: 'evals remote curl output' },
    { re: /\bgit\s+push\s+(?:--force\b|-f\b)/, reason: 'force-push rewrites remote history' },
    { re: /\bgit\s+reset\s+--hard\b/, reason: 'hard reset discards uncommitted work' },
    { re: /\bgit\s+clean\s+-[fdx]{1,3}\b/, reason: 'git clean removes untracked files' },
    { re: /\bhistory\s+-c\b/, reason: 'clears shell history' },
    { re: /\biptables\s+-F\b/, reason: 'flushes firewall rules' },
    { re: /\bkubectl\s+delete\b.*--all\b/, reason: 'kubectl delete --all' },
    { re: /\bdocker\s+system\s+prune\s+.*-a\b/, reason: 'docker system prune -a' },
    { re: /\bnpm\s+publish\b/, reason: 'publishes to npm registry' },
    { re: /\bbun\s+publish\b/, reason: 'publishes to bun registry' },
    { re: /\byarn\s+publish\b/, reason: 'publishes to yarn registry' },
    { re: /\bpip\s+install\s+--system\b/, reason: 'system-wide pip install' },
    { re: /\bbrew\s+uninstall\b.*--force\b/, reason: 'force uninstall via brew' },
    { re: /\/etc\/(passwd|shadow|sudoers)\b/, reason: 'touches sensitive system files' },
];
