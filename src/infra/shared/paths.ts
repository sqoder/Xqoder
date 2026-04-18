import * as os from 'node:os';
import * as path from 'node:path';

export interface XQoderPaths {
    homeDir: string;
    rootDir: string;
    configFile: string;
    tuiConfigFile: string;
    dataDir: string;
    sessionDbFile: string;
    rollbackDir: string;
    shareDir: string;
}

export function getXQoderPaths(homeDir: string = os.homedir()): XQoderPaths {
    const rootDir = path.join(homeDir, '.xqoder');
    const dataDir = path.join(rootDir, 'data');
    const rollbackDir = path.join(dataDir, 'rollbacks');
    const shareDir = path.join(dataDir, 'shares');

    return {
        homeDir,
        rootDir,
        configFile: path.join(rootDir, 'config.json'),
        tuiConfigFile: path.join(rootDir, 'tui.json'),
        dataDir,
        sessionDbFile: path.join(dataDir, 'sessions.sqlite'),
        rollbackDir,
        shareDir,
    };
}
