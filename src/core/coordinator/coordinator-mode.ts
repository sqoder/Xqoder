// P19d — Coordinator mode: feature-flag check + system-prompt context.
//
// When COORDINATOR_MODE is enabled, the main session acts as a dispatcher:
// it spawns worker subagents via delegate_task, communicates via send_message,
// and manages teams via team_create / team_delete.
//
// The scratchpad directory (~/.xqoder/swarm/<sessionId>/) is the shared
// mailbox: each worker polls its JSON inbox file; the coordinator writes to it.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface CoordinatorMailboxMessage {
    id: string;
    from: string;
    to: string;
    content: string;
    sentAt: string;
}

export interface TeamEntry {
    name: string;
    description?: string;
    agentType?: string;
    createdAt: string;
}

export interface CoordinatorState {
    sessionId: string;
    scratchpadDir: string;
    teams: Map<string, TeamEntry>;
}

// ---------------------------------------------------------------------------
// Feature flag check (reads env var directly — no bootstrap dep)
// ---------------------------------------------------------------------------

export function isCoordinatorMode(): boolean {
    const env = process.env['XQODER_FEATURE_COORDINATOR_MODE'] ?? process.env['COORDINATOR_MODE'];
    return env === '1' || env === 'true';
}

// ---------------------------------------------------------------------------
// Scratchpad directory
// ---------------------------------------------------------------------------

export function getSwarmDir(homeDir?: string): string {
    return path.join(homeDir ?? os.homedir(), '.xqoder', 'swarm');
}

export function getScratchpadDir(sessionId: string, homeDir?: string): string {
    return path.join(getSwarmDir(homeDir), sessionId);
}

export function ensureScratchpadDir(sessionId: string, homeDir?: string): string {
    const dir = getScratchpadDir(sessionId, homeDir);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// ---------------------------------------------------------------------------
// Mailbox helpers
// ---------------------------------------------------------------------------

function mailboxPath(scratchpadDir: string, agentName: string): string {
    return path.join(scratchpadDir, `${agentName}.inbox.json`);
}

export function writeToMailbox(
    scratchpadDir: string,
    to: string,
    from: string,
    content: string,
): CoordinatorMailboxMessage {
    const msg: CoordinatorMailboxMessage = {
        id: crypto.randomUUID(),
        from,
        to,
        content,
        sentAt: new Date().toISOString(),
    };

    const filePath = mailboxPath(scratchpadDir, to);
    let existing: CoordinatorMailboxMessage[] = [];
    if (fs.existsSync(filePath)) {
        try {
            existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CoordinatorMailboxMessage[];
        } catch {
            existing = [];
        }
    }
    existing.push(msg);
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');
    return msg;
}

export function readMailbox(
    scratchpadDir: string,
    agentName: string,
): CoordinatorMailboxMessage[] {
    const filePath = mailboxPath(scratchpadDir, agentName);
    if (!fs.existsSync(filePath)) return [];
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CoordinatorMailboxMessage[];
    } catch {
        return [];
    }
}

export function clearMailbox(scratchpadDir: string, agentName: string): void {
    const filePath = mailboxPath(scratchpadDir, agentName);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

// ---------------------------------------------------------------------------
// Team registry (in-memory, per-process)
// ---------------------------------------------------------------------------

const TEAM_REGISTRY = new Map<string, TeamEntry>();

export function registerTeam(entry: TeamEntry): void {
    TEAM_REGISTRY.set(entry.name, entry);
}

export function unregisterTeam(name: string): boolean {
    return TEAM_REGISTRY.delete(name);
}

export function getTeam(name: string): TeamEntry | undefined {
    return TEAM_REGISTRY.get(name);
}

export function listTeams(): TeamEntry[] {
    return Array.from(TEAM_REGISTRY.values());
}

export function __resetTeamRegistryForTests(): void {
    TEAM_REGISTRY.clear();
}
