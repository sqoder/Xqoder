// P25 follow-up — wire runDaemon into the CLI handler with feature flag check.
import { feature } from '../../shared/feature-flags.js';
import { createStub } from './stub.js';

const stub = createStub('daemon', 'daemon');

export const run = async (args: string[]): Promise<void> => {
    if (!feature('DAEMON')) {
        return stub(args);
    }
    const { runDaemon } = await import('../../core/daemon/index.js');
    const socketPath = args.find((a) => a.startsWith('--socket='))?.slice('--socket='.length);
    await runDaemon({ ...(socketPath ? { socketPath } : {}) });
};
