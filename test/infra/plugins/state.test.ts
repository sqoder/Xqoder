// P18 — per-plugin enable/disable state persisted at
// ~/.xqoder/plugins/state.json.

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    isPluginEnabled,
    loadPluginState,
    setPluginEnabled,
} from '../../../src/infra/plugins/state.js';

function newHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-home-'));
}

describe('plugin state', () => {
    it('defaults to enabled when state file is absent', () => {
        const home = newHome();
        expect(isPluginEnabled('x', { homeDir: home })).toBe(true);
        expect(loadPluginState({ homeDir: home })).toEqual({ disabled: [] });
    });

    it('round-trips disabled plugin names', () => {
        const home = newHome();
        setPluginEnabled('foo', false, { homeDir: home });
        expect(isPluginEnabled('foo', { homeDir: home })).toBe(false);
        expect(isPluginEnabled('bar', { homeDir: home })).toBe(true);

        setPluginEnabled('foo', true, { homeDir: home });
        expect(isPluginEnabled('foo', { homeDir: home })).toBe(true);
    });

    it('ignores corrupt state.json and returns defaults', () => {
        const home = newHome();
        const statePath = path.join(home, '.xqoder', 'plugins', 'state.json');
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(statePath, 'not json');

        expect(loadPluginState({ homeDir: home })).toEqual({ disabled: [] });
        // And a subsequent write should fix the file.
        setPluginEnabled('a', false, { homeDir: home });
        expect(loadPluginState({ homeDir: home })).toEqual({ disabled: ['a'] });
    });
});
