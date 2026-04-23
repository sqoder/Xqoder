import * as vscode from 'vscode';
import { XQoderChatPanel } from './panel/chat-panel';
import { showApprovalDiffPreview } from './review/diff-view';

export function activate(context: vscode.ExtensionContext): void {
    const panel = new XQoderChatPanel(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('xqoder.openChatPanel', () => panel.reveal()),
        vscode.commands.registerCommand('xqoder.openDiffPreview', async (...args: unknown[]) => {
            const title = typeof args[0] === 'string' ? args[0] : undefined;
            const preview = typeof args[1] === 'string' ? args[1] : undefined;
            await showApprovalDiffPreview(title ?? 'XQoder Preview', preview ?? '');
        }),
    );
}

export function deactivate(): void {
    // VS Code tears down commands and panels through extension subscriptions.
}
