export {
    type ClientMessage,
    type DaemonMessage,
    type IPCMessage,
    type CellUpdate,
    type DaemonRuntimePaths,
    decodeMessages,
    encodeMessage,
    getDaemonRuntimePaths,
    getHealthFilePath,
    getPidFilePath,
    getReadyFilePath,
    getSocketPath,
} from './ipc-protocol.js';

export {
    type DaemonDoctorReport,
    createDaemonDoctorReport,
    createHostedTuiFallbackMessage,
    formatDaemonDoctorReport,
} from './doctor.js';

export {
    type DaemonRuntimeState,
    type DaemonStatusSnapshot,
    type DaemonStartResult,
    type DaemonStopResult,
    allowDebugFrameFallback,
    cleanupDaemonArtifacts,
    createDaemonStatusSnapshot,
    readDaemonRuntimeState,
    startDaemonProcess,
    stopDaemonProcess,
    writeDaemonRuntimeState,
} from './control.js';

export {
    type SessionManagerOptions,
    ClientSession,
    SessionManager,
} from './session-manager.js';

export {
    DAEMON_IDLE_TIMEOUT_ENV,
    DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
    formatDaemonIdleTimeout,
    getDaemonIdleCheckIntervalMs,
    parseDaemonIdleTimeout,
    resolveDaemonIdleTimeout,
    type ResolvedDaemonIdleTimeout,
} from './idle-timeout.js';
