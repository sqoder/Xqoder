import * as vscode from 'vscode';

/**
 * Virtual file-system provider for XQoder approval diffs.
 *
 * We register the scheme `xqoder-approval:` on activation. The URIs look like:
 *
 *   xqoder-approval:/before/<approvalKey>?path=<filePath>
 *   xqoder-approval:/after/<approvalKey>?path=<filePath>
 *
 * Content is stored in-memory keyed by the full URI, so the diff editor can
 * read both sides without any temp-file writes.
 */
export class ApprovalDiffContentProvider implements vscode.TextDocumentContentProvider {
    public static readonly SCHEME = 'xqoder-approval';

    private readonly contents = new Map<string, string>();
    private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

    public readonly onDidChange = this.onDidChangeEmitter.event;

    public setContent(uri: vscode.Uri, content: string): void {
        const key = uri.toString();
        const previous = this.contents.get(key);
        this.contents.set(key, content);
        if (previous !== undefined && previous !== content) {
            this.onDidChangeEmitter.fire(uri);
        }
    }

    public clearContent(uri: vscode.Uri): void {
        this.contents.delete(uri.toString());
    }

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.toString()) ?? '';
    }

    public dispose(): void {
        this.onDidChangeEmitter.dispose();
        this.contents.clear();
    }
}

export function buildApprovalDiffUris(params: {
    approvalKey: string;
    filePath: string;
}): { before: vscode.Uri; after: vscode.Uri } {
    const encodedKey = encodeURIComponent(params.approvalKey);
    const encodedPath = encodeURIComponent(params.filePath);
    const beforeUri = vscode.Uri.parse(
        `${ApprovalDiffContentProvider.SCHEME}:/before/${encodedKey}?path=${encodedPath}`,
    );
    const afterUri = vscode.Uri.parse(
        `${ApprovalDiffContentProvider.SCHEME}:/after/${encodedKey}?path=${encodedPath}`,
    );
    return { before: beforeUri, after: afterUri };
}
