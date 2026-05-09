import * as path from 'node:path';
import * as vscode from 'vscode';
import { showApprovalDiffPreview, showNativeApprovalDiff } from '../review/diff-view';
import type { ApprovalDiffContentProvider } from '../review/content-provider';
import {
    getApprovalKey,
    resolveApprovalTarget,
    toPanelApproval,
    toPendingApproval,
    toPendingApprovals,
    type PanelApproval,
    type PendingApproval,
} from './approval-state';

type PanelTranscriptMessage = {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
};

type PendingQuestion = {
    requestId: string;
    question: string;
    header?: string;
    options: Array<{ label: string; description?: string }>;
    allowCustom?: boolean;
};

type StreamWireRecord =
    | {
        type: 'event';
        streamId: string;
        seq: number;
        cursor: number;
        event: {
            type: string;
            payload: Record<string, unknown>;
        };
    }
    | {
        type: 'done' | 'error' | 'cancelled';
        streamId: string;
        seq: number;
        cursor: number;
        response?: string;
        sessionId?: string;
        message?: string;
        reason?: string;
    };

interface PanelStatePayload {
    sessionId?: string;
    status: string;
    busy: boolean;
    transcript: PanelTranscriptMessage[];
    approvals: PanelApproval[];
    questions: PendingQuestion[];
}

interface PersistedPanelState extends Omit<PanelStatePayload, 'approvals'> {
    approvals: PendingApproval[];
    activeStreamId?: string;
}

interface SessionDetailPayload {
    id?: unknown;
    transcript?: unknown;
    pendingApprovals?: unknown;
}

const PANEL_STATE_KEY = 'xqoder.chatPanelState';

export class XQoderChatPanel {
    private panel: vscode.WebviewPanel | undefined;
    private sessionId: string | undefined;
    private activeStreamId: string | undefined;
    private busy = false;
    private status = 'idle';
    private readonly transcript: PanelTranscriptMessage[] = [];
    private readonly pendingApprovals = new Map<string, PendingApproval>();
    private readonly pendingQuestions = new Map<string, PendingQuestion>();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly contentProvider?: ApprovalDiffContentProvider,
    ) {
        this.sessionId = context.workspaceState.get<string>('xqoder.sessionId');
        this.restorePersistedState();
    }

    reveal(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            this.postState();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'xqoder.chat',
            'XQoder',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );
        this.panel.webview.html = this.renderHtml(this.panel.webview);
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
        this.panel.webview.onDidReceiveMessage(async (message) => {
            await this.handleWebviewMessage(message);
        });
        this.postState();
        void this.restoreSessionView();
    }

    private async handleWebviewMessage(message: unknown): Promise<void> {
        if (!message || typeof message !== 'object') {
            return;
        }

        const typed = message as { type?: string; prompt?: string; requestId?: string; approvalKey?: string; decision?: string; selected?: string; customText?: string };
        switch (typed.type) {
            case 'send-prompt':
                if (typeof typed.prompt === 'string' && typed.prompt.trim()) {
                    await this.sendPrompt(typed.prompt.trim());
                }
                return;
            case 'resolve-approval':
                if ((typed.approvalKey || typed.requestId) && (typed.decision === 'allow' || typed.decision === 'deny')) {
                    await this.resolveApproval(typed.approvalKey ?? typed.requestId!, typed.decision);
                }
                return;
            case 'resolve-question':
                if (typed.requestId && typeof typed.selected === 'string') {
                    await this.resolveQuestion(typed.requestId, typed.selected, typed.customText);
                }
                return;
            case 'open-preview':
                if (typed.approvalKey || typed.requestId) {
                    const approval = this.pendingApprovals.get(typed.approvalKey ?? typed.requestId!);
                    if (approval?.preview) {
                        await showApprovalDiffPreview(approval.summary, approval.preview);
                    }
                }
                return;
            default:
                return;
        }
    }

    private async sendPrompt(prompt: string): Promise<void> {
        if (this.busy) {
            void vscode.window.showWarningMessage('XQoder is still processing the previous prompt.');
            return;
        }

        this.busy = true;
        this.status = 'connecting';
        this.appendTranscript('user', prompt);
        this.postState();

        try {
            const sessionId = await this.ensureSession();
            const finalPrompt = await this.buildPromptWithSelection(prompt);
            await this.streamPrompt(sessionId, finalPrompt);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.appendTranscript('system', `Error: ${message}`);
            void vscode.window.showErrorMessage(`XQoder panel failed: ${message}`);
        } finally {
            this.busy = false;
            this.status = 'idle';
            if (this.pendingApprovals.size === 0 && this.pendingQuestions.size === 0) {
                this.activeStreamId = undefined;
            }
            this.postState();
        }
    }

    private async ensureSession(): Promise<string> {
        if (this.sessionId) {
            return this.sessionId;
        }

        const workspaceRoot = this.getWorkspaceRoot();
        const result = await this.fetchJson<{ id: string }>('/session', {
            method: 'POST',
            body: JSON.stringify({
                projectRoot: workspaceRoot,
                title: 'VS Code Session',
            }),
        });
        this.sessionId = result.id;
        await this.context.workspaceState.update('xqoder.sessionId', this.sessionId);
        this.postState();
        return result.id;
    }

    private async buildPromptWithSelection(prompt: string): Promise<string> {
        if (!this.getConfig().autoIncludeSelection) {
            return prompt;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            return prompt;
        }

        const selectedText = editor.document.getText(editor.selection).trim();
        if (!selectedText) {
            return prompt;
        }

        const relativePath = vscode.workspace.asRelativePath(editor.document.uri.fsPath);
        const start = editor.selection.start.line + 1;
        const end = editor.selection.end.line + 1;
        return [
            prompt,
            '',
            '[IDE Selection]',
            `@${relativePath}:${start}-${end}`,
            selectedText,
        ].join('\n');
    }

    private async streamPrompt(sessionId: string, prompt: string): Promise<void> {
        const response = await fetch(this.toUrl(`/session/${encodeURIComponent(sessionId)}/message/stream`), {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify({
                message: prompt,
                timeoutMs: 120000,
            }),
        });
        if (!response.ok || !response.body) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
        }

        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        let buffer = '';
        let activeAssistantIndex: number | undefined;

        while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
                break;
            }

            buffer += decoder.decode(chunk.value, { stream: true });
            let newline = buffer.indexOf('\n');
            while (newline !== -1) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf('\n');
                if (!line) {
                    continue;
                }
                const record = JSON.parse(line) as StreamWireRecord;
                this.activeStreamId = record.streamId;

                if (record.type !== 'event') {
                    if (record.type === 'done') {
                        this.activeStreamId = undefined;
                        this.postState();
                        continue;
                    }
                    if (record.type === 'error') {
                        throw new Error(record.message ?? 'Stream failed');
                    }
                    if (record.type === 'cancelled') {
                        throw new Error(record.reason ?? 'Stream cancelled');
                    }
                    continue;
                }

                const event = record.event;
                if (event.type === 'message.delta' && event.payload.role === 'assistant') {
                    if (activeAssistantIndex === undefined) {
                        activeAssistantIndex = this.appendTranscript('assistant', '');
                    }
                    this.transcript[activeAssistantIndex] = {
                        role: 'assistant',
                        content: `${this.transcript[activeAssistantIndex]?.content ?? ''}${String(event.payload.text ?? '')}`,
                    };
                    this.status = 'streaming';
                    this.postState();
                    continue;
                }

                const completedMessage = typeof event.payload.message === 'object' && event.payload.message !== null
                    ? event.payload.message as { role?: unknown; content?: unknown }
                    : undefined;
                if (event.type === 'message.completed' && completedMessage?.role === 'assistant') {
                    const content = typeof completedMessage.content === 'string'
                        ? completedMessage.content
                        : String(completedMessage.content ?? '');
                    if (activeAssistantIndex === undefined) {
                        activeAssistantIndex = this.appendTranscript('assistant', content);
                    } else {
                        this.transcript[activeAssistantIndex] = {
                            role: 'assistant',
                            content,
                        };
                    }
                    this.postState();
                    continue;
                }

                if (event.type === 'status.changed') {
                    this.status = String(event.payload.status ?? 'idle');
                    this.postState();
                    continue;
                }

                if (event.type === 'approval.requested') {
                    const approval = toPendingApproval(event.payload, record.streamId);
                    const approvalKey = getApprovalKey(approval);
                    this.pendingApprovals.set(approvalKey, approval);
                    if (approval.preview && (approval.toolName === 'write_file' || approval.toolName === 'edit_file' || approval.toolName === 'apply_patch')) {
                        void this.renderApprovalDiff(approvalKey, approval);
                    }
                    this.postState();
                    continue;
                }

                if (event.type === 'approval.resolved') {
                    this.pendingApprovals.delete(getApprovalKey({
                        requestId: String(event.payload.requestId ?? ''),
                        streamId: record.streamId,
                    }));
                    this.postState();
                    continue;
                }

                if (event.type === 'question.requested') {
                    const question = this.toPendingQuestion(event.payload);
                    this.pendingQuestions.set(question.requestId, question);
                    this.postState();
                    continue;
                }

                if (event.type === 'question.resolved') {
                    this.pendingQuestions.delete(String(event.payload.requestId ?? ''));
                    this.postState();
                    continue;
                }
            }
        }
    }

    private async resolveApproval(approvalKey: string, decision: 'allow' | 'deny'): Promise<void> {
        if (!this.sessionId) {
            return;
        }

        const target = resolveApprovalTarget(approvalKey, this.pendingApprovals, this.activeStreamId);
        await this.fetchJson(`/session/${encodeURIComponent(this.sessionId)}/approval/${encodeURIComponent(target.requestId)}/resolve`, {
            method: 'POST',
            body: JSON.stringify({
                decision,
                ...(target.streamId ? { streamId: target.streamId } : {}),
            }),
        });
        this.pendingApprovals.delete(approvalKey);
        this.postState();
    }

    private async resolveQuestion(
        requestId: string,
        selected: string,
        customText?: string,
    ): Promise<void> {
        if (!this.sessionId) {
            return;
        }

        await this.fetchJson(`/session/${encodeURIComponent(this.sessionId)}/question/${encodeURIComponent(requestId)}/resolve`, {
            method: 'POST',
            body: JSON.stringify({
                selected: [selected],
                customText,
                streamId: this.activeStreamId,
            }),
        });
        this.pendingQuestions.delete(requestId);
        this.postState();
    }

    private toPendingQuestion(payload: Record<string, unknown>): PendingQuestion {
        const rawOptions = Array.isArray(payload.options) ? payload.options : [];
        return {
            requestId: String(payload.requestId ?? 'question'),
            question: String(payload.question ?? 'Answer the pending question'),
            ...(typeof payload.header === 'string' && payload.header.trim().length > 0
                ? { header: payload.header }
                : {}),
            options: rawOptions
                .filter((entry): entry is { label: string; description?: string } => typeof entry === 'object' && entry !== null && typeof (entry as { label?: unknown }).label === 'string')
                .map((entry) => ({
                    label: entry.label,
                    ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
                })),
            ...(payload.allowCustom === true ? { allowCustom: true } : {}),
        };
    }

    private restorePersistedState(): void {
        const persisted = this.context.workspaceState.get<PersistedPanelState>(PANEL_STATE_KEY);
        if (!persisted) {
            return;
        }

        const transcript = Array.isArray(persisted.transcript) ? persisted.transcript : [];
        const approvals = Array.isArray(persisted.approvals) ? persisted.approvals : [];
        const questions = Array.isArray(persisted.questions) ? persisted.questions : [];
        this.sessionId = persisted.sessionId ?? this.sessionId;
        this.activeStreamId = persisted.activeStreamId;
        const hasInteractiveState = Boolean(this.activeStreamId)
            || approvals.length > 0
            || questions.length > 0;
        this.busy = hasInteractiveState && persisted.busy;
        this.status = persisted.status || 'idle';
        this.transcript.push(...transcript);

        for (const approval of toPendingApprovals(approvals)) {
            this.pendingApprovals.set(getApprovalKey(approval), approval);
        }

        for (const question of questions) {
            this.pendingQuestions.set(question.requestId, question);
        }
    }

    private async restoreSessionView(): Promise<void> {
        if (!this.sessionId || this.activeStreamId || this.pendingApprovals.size > 0 || this.pendingQuestions.size > 0) {
            return;
        }

        const previousStatus = this.status;
        if (!this.busy) {
            this.status = 'restoring';
            this.postState();
        }

        try {
            const detail = await this.fetchJson<SessionDetailPayload>(`/session/${encodeURIComponent(this.sessionId)}`);
            const transcript = this.toTranscriptMessages(detail.transcript);
            if (transcript.length > 0) {
                this.transcript.splice(0, this.transcript.length, ...transcript);
            }
            for (const approval of toPendingApprovals(detail.pendingApprovals)) {
                this.pendingApprovals.set(getApprovalKey(approval), approval);
            }
            if (typeof detail.id === 'string' && detail.id.trim().length > 0) {
                this.sessionId = detail.id;
            }
        } catch (error) {
            if (this.isMissingSessionError(error)) {
                await this.clearSessionState();
                return;
            }
        } finally {
            if (!this.busy) {
                this.status = previousStatus;
            }
            this.postState();
        }
    }

    private async clearSessionState(): Promise<void> {
        this.sessionId = undefined;
        this.activeStreamId = undefined;
        this.busy = false;
        this.status = 'idle';
        this.transcript.splice(0, this.transcript.length);
        this.pendingApprovals.clear();
        this.pendingQuestions.clear();
        await this.context.workspaceState.update('xqoder.sessionId', undefined);
    }

    private toTranscriptMessages(rawTranscript: unknown): PanelTranscriptMessage[] {
        if (!Array.isArray(rawTranscript)) {
            return [];
        }

        return rawTranscript
            .filter((entry): entry is { role?: unknown; content?: unknown } => typeof entry === 'object' && entry !== null)
            .map((entry) => ({
                role: this.toTranscriptRole(entry.role),
                content: typeof entry.content === 'string'
                    ? entry.content
                    : String(entry.content ?? ''),
            }));
    }

    private toTranscriptRole(value: unknown): PanelTranscriptMessage['role'] {
        return value === 'assistant' || value === 'system' || value === 'tool'
            ? value
            : 'user';
    }

    private isMissingSessionError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error);
        return message.includes('Session not found');
    }

    private appendTranscript(role: PanelTranscriptMessage['role'], content: string): number {
        this.transcript.push({ role, content });
        return this.transcript.length - 1;
    }

    /**
     * Public entry called by the `xqoder.approveActiveDiff` /
     * `xqoder.rejectActiveDiff` commands. Lets the user resolve an approval
     * from a toolbar button, editor toolbar action, or the diff editor
     * toolbar without having to switch back to the webview.
     */
    public async resolveApprovalFromCommand(
        approvalKey: string,
        decision: 'allow' | 'deny',
    ): Promise<void> {
        if (!this.pendingApprovals.has(approvalKey)) {
            void vscode.window.showWarningMessage('That XQoder approval has already been resolved.');
            return;
        }
        await this.resolveApproval(approvalKey, decision);
    }

    private async renderApprovalDiff(approvalKey: string, approval: PendingApproval): Promise<void> {
        if (!approval.preview) {
            return;
        }

        const workspaceRoot = this.tryGetWorkspaceRoot();
        const nativeOpened = this.contentProvider
            ? await showNativeApprovalDiff({
                approvalKey,
                toolName: approval.toolName,
                summary: approval.summary,
                preview: approval.preview,
                ...(workspaceRoot ? { workspaceRoot } : {}),
                contentProvider: this.contentProvider,
            })
            : false;

        if (!nativeOpened) {
            await showApprovalDiffPreview(approval.summary, approval.preview);
            return;
        }

        // Offer Apply / Reject as an info toast so the user can resolve the
        // approval without switching back to the chat panel.
        const choice = await vscode.window.showInformationMessage(
            approval.summary,
            'Apply',
            'Reject',
        );
        if (choice === 'Apply') {
            await this.resolveApprovalFromCommand(approvalKey, 'allow');
        } else if (choice === 'Reject') {
            await this.resolveApprovalFromCommand(approvalKey, 'deny');
        }
    }

    private tryGetWorkspaceRoot(): string | undefined {
        try {
            return this.getWorkspaceRoot();
        } catch {
            return undefined;
        }
    }

    private postState(): void {
        const pendingApprovals = Array.from(this.pendingApprovals.values());
        const payload: PanelStatePayload = {
            sessionId: this.sessionId,
            status: this.status,
            busy: this.busy,
            transcript: this.transcript,
            approvals: pendingApprovals.map(toPanelApproval),
            questions: Array.from(this.pendingQuestions.values()),
        };

        void this.context.workspaceState.update(PANEL_STATE_KEY, {
            ...payload,
            approvals: pendingApprovals,
            ...(this.activeStreamId ? { activeStreamId: this.activeStreamId } : {}),
        } satisfies PersistedPanelState);

        if (!this.panel) {
            return;
        }

        this.panel.webview.postMessage({
            type: 'hydrate',
            payload,
        });
    }

    private getWorkspaceRoot(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            return workspaceFolder.uri.fsPath;
        }
        const editorPath = vscode.window.activeTextEditor?.document.uri.fsPath;
        if (editorPath) {
            return path.dirname(editorPath);
        }
        throw new Error('Open a workspace folder or file before using the XQoder panel.');
    }

    private getConfig(): {
        serverUrl: string;
        basicAuthUser: string;
        basicAuthPassword: string;
        autoIncludeSelection: boolean;
    } {
        const config = vscode.workspace.getConfiguration('xqoder');
        return {
            serverUrl: String(config.get('serverUrl') ?? 'http://127.0.0.1:4096').replace(/\/$/, ''),
            basicAuthUser: String(config.get('basicAuthUser') ?? 'xqoder'),
            basicAuthPassword: String(config.get('basicAuthPassword') ?? ''),
            autoIncludeSelection: Boolean(config.get('autoIncludeSelection') ?? true),
        };
    }

    private buildHeaders(): Record<string, string> {
        const config = this.getConfig();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (config.basicAuthPassword) {
            headers.Authorization = `Basic ${Buffer.from(`${config.basicAuthUser}:${config.basicAuthPassword}`).toString('base64')}`;
        }
        return headers;
    }

    private toUrl(pathname: string): string {
        return `${this.getConfig().serverUrl}${pathname}`;
    }

    private async fetchJson<T = unknown>(pathname: string, init?: RequestInit): Promise<T> {
        const response = await fetch(this.toUrl(pathname), {
            ...init,
            headers: {
                ...this.buildHeaders(),
                ...(init?.headers as Record<string, string> | undefined),
            },
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
        }
        return response.json() as Promise<T>;
    }

    private renderHtml(webview: vscode.Webview): string {
        const nonce = String(Date.now());
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>XQoder</title>
  <style>
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      line-height: 1.4;
      margin: 0;
      padding: 0;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      overflow-x: hidden;
    }
    .container {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .header {
      padding: 8px 12px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      opacity: 0.8;
    }
    .scroll-area {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .input-area {
      padding: 12px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
    }
    textarea {
      width: 100%;
      min-height: 60px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 8px;
      resize: vertical;
      font-family: inherit;
      font-size: inherit;
    }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .button-row { margin-top: 8px; display: flex; gap: 8px; align-items: center; }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      padding: 4px 12px;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .muted { opacity: 0.7; font-size: 11px; }
    .card {
      border: 1px solid var(--vscode-panel-border);
      padding: 10px;
      background: color-mix(in srgb, var(--vscode-editor-background) 95%, var(--vscode-editor-foreground) 5%);
    }
    .msg-user { border-left: 2px solid var(--vscode-textLink-foreground); }
    .msg-assistant { border-left: 2px solid var(--vscode-charts-green); }
    .msg-system { opacity: 0.8; font-size: 12px; }
    .card-header { font-weight: 600; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; }
    .card-content { white-space: pre-wrap; word-break: break-word; }
    .diff-preview {
      margin: 8px 0;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-panel-border);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      padding: 4px;
      max-height: 150px;
      overflow-y: auto;
      white-space: pre;
    }
    .diff-add { color: var(--vscode-charts-green); }
    .diff-del { color: var(--vscode-charts-red); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <strong>XQODER</strong>
      <div>
        <span id="status">idle</span>
        <span id="session" style="margin-left: 8px;">session=none</span>
      </div>
    </div>
    <div id="scroll-area" class="scroll-area">
      <div id="transcript" style="display: contents;"></div>
      <div id="approvals" style="display: contents;"></div>
      <div id="questions" style="display: contents;"></div>
    </div>
    <div class="input-area">
      <textarea id="prompt" placeholder="Ask XQoder..."></textarea>
      <div class="button-row">
        <button id="send">Send</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const status = document.getElementById('status');
    const session = document.getElementById('session');
    const prompt = document.getElementById('prompt');
    const scrollArea = document.getElementById('scroll-area');
    const transcript = document.getElementById('transcript');
    const approvals = document.getElementById('approvals');
    const questions = document.getElementById('questions');

    prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });

    document.getElementById('send').onclick = doSend;

    function doSend() {
      const val = prompt.value.trim();
      if (!val) return;
      vscode.postMessage({ type: 'send-prompt', prompt: val });
      prompt.value = '';
    }

    window.addEventListener('message', (event) => {
      const payload = event.data?.payload;
      if (!payload) return;

      status.textContent = payload.busy ? payload.status + '...' : payload.status;
      session.textContent = payload.sessionId ? 'session=' + payload.sessionId : 'session=none';

      transcript.innerHTML = (payload.transcript || []).map(msg => \`
        <div class="card msg-\${msg.role}">
          <div class="card-header">\${msg.role}</div>
          <div class="card-content">\${escapeHtml(msg.content)}</div>
        </div>
      \`).join('');

      approvals.innerHTML = (payload.approvals || []).map(item => {
        const approvalKey = item.approvalKey || (item.streamId ? item.streamId + ':' + item.requestId : item.requestId);
        return \`
        <div class="card">
          <div class="card-header">Approval Requested</div>
          <div>\${escapeHtml(item.summary)}</div>
          <div class="muted">\${escapeHtml(item.toolName)}\${item.risk ? ' · risk=' + item.risk : ''}</div>
          \${item.preview ? \`<div class="diff-preview">\${renderDiff(item.preview)}</div>\` : ''}
          <div class="button-row">
            <button data-approval-key="\${escapeHtml(approvalKey)}" data-decision="allow">Allow</button>
            <button class="secondary" data-approval-key="\${escapeHtml(approvalKey)}" data-decision="deny">Deny</button>
            \${item.preview ? \`<button class="secondary" data-preview="\${escapeHtml(approvalKey)}">Full Diff</button>\` : ''}
          </div>
        </div>
      \`;
      }).join('');

      questions.innerHTML = (payload.questions || []).map(item => \`
        <div class="card">
          <div class="card-header">\${escapeHtml(item.header || 'Question')}</div>
          <div>\${escapeHtml(item.question)}</div>
          <div class="button-row">
            \${item.options.map(opt => \`<button data-question="\${escapeHtml(item.requestId)}" data-option="\${escapeHtml(opt.label)}">\${escapeHtml(opt.label)}</button>\`).join('')}
          </div>
        </div>
      \`).join('');

      attachListeners();
      scrollArea.scrollTop = scrollArea.scrollHeight;
    });

    function renderDiff(diff) {
      return diff.split('\\n').slice(0, 8).map(line => {
        let cls = '';
        if (line.startsWith('+')) cls = 'class="diff-add"';
        else if (line.startsWith('-')) cls = 'class="diff-del"';
        return \`<div \${cls}>\${escapeHtml(line)}</div>\`;
      }).join('');
    }

    function attachListeners() {
      document.querySelectorAll('[data-decision]').forEach(btn => {
        btn.onclick = () => vscode.postMessage({ type: 'resolve-approval', approvalKey: btn.getAttribute('data-approval-key'), decision: btn.getAttribute('data-decision') });
      });
      document.querySelectorAll('[data-preview]').forEach(btn => {
        btn.onclick = () => vscode.postMessage({ type: 'open-preview', approvalKey: btn.getAttribute('data-preview') });
      });
      document.querySelectorAll('[data-question]').forEach(btn => {
        btn.onclick = () => vscode.postMessage({ type: 'resolve-question', requestId: btn.getAttribute('data-question'), selected: btn.getAttribute('data-option') });
      });
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    }
  </script>
</body>
</html>`;
    }
}
