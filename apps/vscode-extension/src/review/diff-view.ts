import * as vscode from 'vscode';

export async function showApprovalDiffPreview(
    title: string,
    preview: string,
): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
        language: 'diff',
        content: preview || '# No preview available\n',
    });

    await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.Beside,
    });

    void vscode.window.showInformationMessage(`Opened approval preview: ${title}`);
}
