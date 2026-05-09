import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { applyDiffToContent, parseDiffPreview } from './diff-parser';
import {
    ApprovalDiffContentProvider,
    buildApprovalDiffUris,
} from './content-provider';

export interface NativeApprovalDiffInput {
    approvalKey: string;
    toolName: string;
    summary: string;
    preview: string;
    workspaceRoot?: string;
    contentProvider: ApprovalDiffContentProvider;
}

/**
 * Try to open a real side-by-side diff for a write/edit approval preview.
 *
 * Returns `true` on success. Returns `false` if the preview cannot be parsed
 * as a unified diff or the diff command fails — callers should fall back to
 * the legacy read-only diff document in that case.
 */
export async function showNativeApprovalDiff(input: NativeApprovalDiffInput): Promise<boolean> {
    const parsed = parseDiffPreview(input.preview);
    if (!parsed) {
        return false;
    }

    const absolutePath = resolveAbsoluteFilePath(parsed.filePath, input.workspaceRoot);
    const currentContent = readFileIfExists(absolutePath);
    const afterContent = applyDiffToContent(parsed, currentContent);
    if (afterContent === undefined) {
        return false;
    }

    const { before: beforeUri, after: afterUri } = buildApprovalDiffUris({
        approvalKey: input.approvalKey,
        filePath: parsed.filePath,
    });

    input.contentProvider.setContent(beforeUri, currentContent ?? '');
    input.contentProvider.setContent(afterUri, afterContent);

    const title = buildDiffTitle(input.toolName, parsed.filePath, parsed.isNewFile);

    try {
        await vscode.commands.executeCommand(
            'vscode.diff',
            beforeUri,
            afterUri,
            title,
            { preview: false, viewColumn: vscode.ViewColumn.Beside },
        );
    } catch {
        input.contentProvider.clearContent(beforeUri);
        input.contentProvider.clearContent(afterUri);
        return false;
    }

    return true;
}

/**
 * Fallback used when the preview text is not a recognisable unified diff.
 * This is the original XQoder behaviour — open a read-only `language: diff`
 * document. Kept for compatibility with approval flows that emit plain
 * text previews.
 */
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

function buildDiffTitle(toolName: string, filePath: string, isNewFile: boolean): string {
    const verb = isNewFile ? 'Create' : toolName === 'edit_file' ? 'Edit' : 'Write';
    return `${verb} ${filePath} (XQoder approval)`;
}

function resolveAbsoluteFilePath(filePath: string, workspaceRoot?: string): string | undefined {
    if (!filePath) {
        return undefined;
    }
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    if (workspaceRoot) {
        return path.resolve(workspaceRoot, filePath);
    }
    return undefined;
}

function readFileIfExists(filePath: string | undefined): string | undefined {
    if (!filePath) {
        return undefined;
    }
    try {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
            return undefined;
        }
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return undefined;
    }
}
