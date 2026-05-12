// P19d — barrel for @xqoder/core-coordinator.

export type { CoordinatorMailboxMessage, CoordinatorState, TeamEntry } from './coordinator-mode.js';
export {
    __resetTeamRegistryForTests,
    clearMailbox,
    ensureScratchpadDir,
    getScratchpadDir,
    getSwarmDir,
    getTeam,
    isCoordinatorMode,
    listTeams,
    readMailbox,
    registerTeam,
    unregisterTeam,
    writeToMailbox,
} from './coordinator-mode.js';
