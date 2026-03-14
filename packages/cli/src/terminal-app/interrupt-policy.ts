import type { TerminalAppState } from '../terminal-core/app-state.js';

export type CtrlCAction = 'cancel-request' | 'arm-quit' | 'confirm-quit';

export function resolveCtrlCAction(state: Pick<TerminalAppState, 'runtimeStatus'>, quitConfirmPending: boolean): CtrlCAction {
    const runtimeBusy = state.runtimeStatus === 'thinking'
        || state.runtimeStatus === 'running-tool'
        || state.runtimeStatus === 'awaiting-approval';

    if (runtimeBusy) {
        return 'cancel-request';
    }

    if (quitConfirmPending) {
        return 'confirm-quit';
    }

    return 'arm-quit';
}
