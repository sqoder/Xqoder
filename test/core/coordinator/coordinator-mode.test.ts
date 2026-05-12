// P19d — coordinator-mode unit tests.

import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    __resetTeamRegistryForTests,
    clearMailbox,
    ensureScratchpadDir,
    getTeam,
    getScratchpadDir,
    isCoordinatorMode,
    listTeams,
    readMailbox,
    registerTeam,
    unregisterTeam,
    writeToMailbox,
} from '../../../src/core/coordinator/coordinator-mode.js';

function tmpHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'xq-coord-'));
}

afterEach(() => {
    __resetTeamRegistryForTests();
    // restore env
    delete process.env['XQODER_FEATURE_COORDINATOR_MODE'];
    delete process.env['COORDINATOR_MODE'];
});

// ---------------------------------------------------------------------------
// isCoordinatorMode
// ---------------------------------------------------------------------------

describe('isCoordinatorMode', () => {
    it('returns false by default', () => {
        expect(isCoordinatorMode()).toBe(false);
    });

    it('returns true when XQODER_FEATURE_COORDINATOR_MODE=1', () => {
        process.env['XQODER_FEATURE_COORDINATOR_MODE'] = '1';
        expect(isCoordinatorMode()).toBe(true);
    });

    it('returns true when COORDINATOR_MODE=true', () => {
        process.env['COORDINATOR_MODE'] = 'true';
        expect(isCoordinatorMode()).toBe(true);
    });

    it('returns false when set to 0', () => {
        process.env['XQODER_FEATURE_COORDINATOR_MODE'] = '0';
        expect(isCoordinatorMode()).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Scratchpad directory
// ---------------------------------------------------------------------------

describe('ensureScratchpadDir', () => {
    it('creates the directory and returns its path', () => {
        const home = tmpHome();
        const dir = ensureScratchpadDir('sess-abc', home);
        expect(fs.existsSync(dir)).toBe(true);
        expect(dir).toBe(getScratchpadDir('sess-abc', home));
    });

    it('is idempotent', () => {
        const home = tmpHome();
        ensureScratchpadDir('sess-abc', home);
        expect(() => ensureScratchpadDir('sess-abc', home)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Mailbox
// ---------------------------------------------------------------------------

describe('mailbox', () => {
    it('writeToMailbox creates a message and readMailbox returns it', () => {
        const home = tmpHome();
        const dir = ensureScratchpadDir('s1', home);
        const msg = writeToMailbox(dir, 'worker-1', 'coordinator', 'hello');
        expect(msg.to).toBe('worker-1');
        expect(msg.from).toBe('coordinator');
        expect(msg.content).toBe('hello');
        expect(typeof msg.id).toBe('string');

        const inbox = readMailbox(dir, 'worker-1');
        expect(inbox).toHaveLength(1);
        expect(inbox[0]?.id).toBe(msg.id);
    });

    it('multiple writes accumulate in the inbox', () => {
        const home = tmpHome();
        const dir = ensureScratchpadDir('s2', home);
        writeToMailbox(dir, 'worker-1', 'coordinator', 'msg1');
        writeToMailbox(dir, 'worker-1', 'coordinator', 'msg2');
        expect(readMailbox(dir, 'worker-1')).toHaveLength(2);
    });

    it('readMailbox returns empty array when no inbox exists', () => {
        const home = tmpHome();
        const dir = ensureScratchpadDir('s3', home);
        expect(readMailbox(dir, 'nobody')).toEqual([]);
    });

    it('clearMailbox removes the inbox file', () => {
        const home = tmpHome();
        const dir = ensureScratchpadDir('s4', home);
        writeToMailbox(dir, 'worker-1', 'coordinator', 'hi');
        clearMailbox(dir, 'worker-1');
        expect(readMailbox(dir, 'worker-1')).toEqual([]);
    });

    it('clearMailbox is safe when inbox does not exist', () => {
        const home = tmpHome();
        const dir = ensureScratchpadDir('s5', home);
        expect(() => clearMailbox(dir, 'nobody')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Team registry
// ---------------------------------------------------------------------------

describe('team registry', () => {
    it('registerTeam and getTeam round-trip', () => {
        registerTeam({ name: 'alpha', createdAt: new Date().toISOString() });
        const team = getTeam('alpha');
        expect(team?.name).toBe('alpha');
    });

    it('listTeams returns all registered teams', () => {
        registerTeam({ name: 'alpha', createdAt: new Date().toISOString() });
        registerTeam({ name: 'beta', createdAt: new Date().toISOString() });
        const names = listTeams().map((t) => t.name).sort();
        expect(names).toEqual(['alpha', 'beta']);
    });

    it('unregisterTeam removes the team', () => {
        registerTeam({ name: 'alpha', createdAt: new Date().toISOString() });
        unregisterTeam('alpha');
        expect(getTeam('alpha')).toBeUndefined();
    });

    it('unregisterTeam returns false for unknown team', () => {
        expect(unregisterTeam('nobody')).toBe(false);
    });

    it('__resetTeamRegistryForTests clears all teams', () => {
        registerTeam({ name: 'alpha', createdAt: new Date().toISOString() });
        __resetTeamRegistryForTests();
        expect(listTeams()).toHaveLength(0);
    });
});
