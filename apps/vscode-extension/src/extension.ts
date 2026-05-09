import * as vscode from 'vscode';
import { XQoderChatPanel } from './panel/chat-panel';
import { showApprovalDiffPreview } from './review/diff-view';
import { ApprovalDiffContentProvider } from './review/content-provider';

export function activate(context: vscode.ExtensionContext): void {
    const contentProvider = new ApprovalDiffContentProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            ApprovalDiffContentProvider.SCHEME,
            contentProvider,
        ),
        contentProvider,
    );

    const panel = new XQoderChatPanel(context, contentProvider);

    context.subscriptions.push(
        vscode.commands.registerCommand('xqoder.openChatPanel', () => panel.reveal()),
        vscode.commands.registerCommand('xqoder.openDiffPreview', async (...args: unknown[]) => {
            const title = typeof args[0] === 'string' ? args[0] : undefined;
            const preview = typeof args[1] === 'string' ? args[1] : undefined;
            await showApprovalDiffPreview(title ?? 'XQoder Preview', preview ?? '');
        }),
        vscode.commands.registerCommand('xqoder.approveActiveDiff', async (...args: unknown[]) => {
            const approvalKey = typeof args[0] === 'string' ? args[0] : undefined;
            if (!approvalKey) {
                void vscode.window.showWarningMessage('No active XQoder approval to apply.');
                return;
            }
            await panel.resolveApprovalFromCommand(approvalKey, 'allow');
        }),
        vscode.commands.registerCommand('xqoder.rejectActiveDiff', async (...args: unknown[]) => {
            const approvalKey = typeof args[0] === 'string' ? args[0] : undefined;
            if (!approvalKey) {
                void vscode.window.showWarningMessage('No active XQoder approval to reject.');
                return;
            }
            await panel.resolveApprovalFromCommand(approvalKey, 'deny');
        }),
    );
}

export function deactivate(): void {
    // VS Code tears down commands and panels through extension subscriptions.
}
