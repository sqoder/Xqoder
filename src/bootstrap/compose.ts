import {
    createHttpInterfaceServer,
    type HttpInterfaceServerOptions,
} from '../interfaces/http/index.js';
import {
    runCliProgram,
} from '../interfaces/cli/index.js';
import {
    runTuiInterface,
    type TuiInterfaceOptions,
} from '../interfaces/tui/index.js';

export interface XQoderEntrypoints {
    runCli: (argv?: string[]) => Promise<void>;
    runTui: (options?: TuiInterfaceOptions) => Promise<void>;
    createHttpServer: (options?: HttpInterfaceServerOptions) => ReturnType<typeof createHttpInterfaceServer>;
}

export function createXQoderEntrypoints(): XQoderEntrypoints {
    return {
        runCli: (argv = process.argv) => runCliProgram(argv),
        runTui: (options = {}) => runTuiInterface(options),
        createHttpServer: (options = {}) => createHttpInterfaceServer(options),
    };
}
