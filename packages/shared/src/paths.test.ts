import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getXQoderPaths } from './paths.js';

describe('getXQoderPaths', () => {
    it('returns the canonical config and data locations under ~/.xqoder', () => {
        const paths = getXQoderPaths('/Users/demo');

        expect(paths).toEqual({
            homeDir: '/Users/demo',
            rootDir: path.join('/Users/demo', '.xqoder'),
            configFile: path.join('/Users/demo', '.xqoder', 'config.json'),
            tuiConfigFile: path.join('/Users/demo', '.xqoder', 'tui.json'),
            dataDir: path.join('/Users/demo', '.xqoder', 'data'),
            sessionDbFile: path.join('/Users/demo', '.xqoder', 'data', 'sessions.sqlite'),
            rollbackDir: path.join('/Users/demo', '.xqoder', 'data', 'rollbacks'),
            shareDir: path.join('/Users/demo', '.xqoder', 'data', 'shares'),
        });
    });
});
