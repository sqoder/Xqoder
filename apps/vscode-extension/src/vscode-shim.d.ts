declare module 'vscode' {
    export const ViewColumn: {
        Beside: number;
    };

    export interface Disposable {
        dispose(): void;
    }

    export interface ExtensionContext {
        readonly subscriptions: Disposable[];
        readonly workspaceState: {
            get<T>(key: string): T | undefined;
            update(key: string, value: unknown): Thenable<void>;
        };
    }

    export interface Selection {
        readonly isEmpty: boolean;
        readonly start: { line: number };
        readonly end: { line: number };
    }

    export interface TextDocument {
        readonly uri: { fsPath: string };
        getText(selection?: Selection): string;
    }

    export interface TextEditor {
        readonly document: TextDocument;
        readonly selection: Selection;
    }

    export interface Webview {
        html: string;
        postMessage(message: unknown): Thenable<boolean>;
        onDidReceiveMessage(listener: (message: unknown) => unknown): Disposable;
    }

    export interface WebviewPanel extends Disposable {
        readonly webview: Webview;
        reveal(viewColumn?: number): void;
        onDidDispose(listener: () => void): Disposable;
    }

    export interface WorkspaceFolder {
        readonly uri: { fsPath: string };
    }

    export interface TextDocumentShowOptions {
        preview?: boolean;
        preserveFocus?: boolean;
        viewColumn?: number;
    }

    export const commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable;
    };

    export const workspace: {
        readonly workspaceFolders: readonly WorkspaceFolder[] | undefined;
        getConfiguration(section?: string): {
            get<T>(key: string): T | undefined;
        };
        asRelativePath(path: string): string;
        openTextDocument(options: { language: string; content: string }): Thenable<TextDocument>;
    };

    export const window: {
        readonly activeTextEditor: TextEditor | undefined;
        createWebviewPanel(
            viewType: string,
            title: string,
            viewColumn: number,
            options: {
                enableScripts?: boolean;
                retainContextWhenHidden?: boolean;
            },
        ): WebviewPanel;
        showTextDocument(document: TextDocument, options?: TextDocumentShowOptions): Thenable<void>;
        showInformationMessage(message: string): Thenable<void>;
        showWarningMessage(message: string): Thenable<void>;
        showErrorMessage(message: string): Thenable<void>;
    };
}
