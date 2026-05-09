declare module 'vscode' {
    export const ViewColumn: {
        Beside: number;
        Active: number;
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

    export interface Uri {
        readonly scheme: string;
        readonly path: string;
        readonly fsPath: string;
        readonly query: string;
        toString(skipEncoding?: boolean): string;
        with(change: { scheme?: string; path?: string; query?: string }): Uri;
    }

    export const Uri: {
        parse(value: string): Uri;
        file(path: string): Uri;
        from(components: { scheme: string; path?: string; query?: string }): Uri;
    };

    export interface CancellationToken {
        readonly isCancellationRequested: boolean;
    }

    export type Event<T> = (listener: (event: T) => unknown) => Disposable;

    export class EventEmitter<T> implements Disposable {
        constructor();
        readonly event: Event<T>;
        fire(data: T): void;
        dispose(): void;
    }

    export interface TextDocumentContentProvider {
        readonly onDidChange?: Event<Uri>;
        provideTextDocumentContent(uri: Uri, token?: CancellationToken): string | Thenable<string>;
    }

    export interface Selection {
        readonly isEmpty: boolean;
        readonly start: { line: number };
        readonly end: { line: number };
    }

    export interface TextDocument {
        readonly uri: Uri | { fsPath: string };
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
        executeCommand<T = unknown>(command: string, ...rest: unknown[]): Thenable<T>;
    };

    export const workspace: {
        readonly workspaceFolders: readonly WorkspaceFolder[] | undefined;
        getConfiguration(section?: string): {
            get<T>(key: string): T | undefined;
        };
        asRelativePath(path: string): string;
        openTextDocument(options: { language: string; content: string } | Uri): Thenable<TextDocument>;
        registerTextDocumentContentProvider(
            scheme: string,
            provider: TextDocumentContentProvider,
        ): Disposable;
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
        showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
        showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
        showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    };
}
