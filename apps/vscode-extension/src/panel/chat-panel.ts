import * as path from 'node:path';
import * as vscode from 'vscode';
import { showApprovalDiffPreview } from '../review/diff-view';

type PanelTranscriptMessage = {
    role: 'user' | 'assistant' | 'system';
    content: string;
};

type PendingApproval = {
    requestId: string;
    summary: string;
    toolName: string;
    preview?: string;
    reason?: string;
    risk?: 'low' | 'medium' | 'high';
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
    approvals: PendingApproval[];
    questions: PendingQuestion[];
}

interface PersistedPanelState extends PanelStatePayload {
    activeStreamId?: string;
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

    constructor(private readonly context: vscode.ExtensionContext) {
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
    }

    private async handleWebviewMessage(message: unknown): Promise<void> {
        if (!message || typeof message !== 'object') {
            return;
        }

        const typed = message as { type?: string; prompt?: string; requestId?: string; decision?: string; selected?: string; customText?: string };
        switch (typed.type) {
            case 'send-prompt':
                if (typeof typed.prompt === 'string' && typed.prompt.trim()) {
                    await this.sendPrompt(typed.prompt.trim());
                }
                return;
            case 'resolve-approval':
                if (typed.requestId && (typed.decision === 'allow' || typed.decision === 'deny')) {
                    await this.resolveApproval(typed.requestId, typed.decision);
                }
                return;
            case 'resolve-question':
                if (typed.requestId && typeof typed.selected === 'string') {
                    await this.resolveQuestion(typed.requestId, typed.selected, typed.customText);
                }
                return;
            case 'open-preview':
                if (typed.requestId) {
                    const approval = this.pendingApprovals.get(typed.requestId);
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
                    const approval = this.toPendingApproval(event.payload);
                    this.pendingApprovals.set(approval.requestId, approval);
                    if (approval.preview && approval.toolName === 'write_file') {
                        void showApprovalDiffPreview(approval.summary, approval.preview);
                    }
                    this.postState();
                    continue;
                }

                if (event.type === 'approval.resolved') {
                    this.pendingApprovals.delete(String(event.payload.requestId ?? ''));
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

    private async resolveApproval(requestId: string, decision: 'allow' | 'deny'): Promise<void> {
        if (!this.sessionId) {
            return;
        }

        await this.fetchJson(`/session/${encodeURIComponent(this.sessionId)}/approval/${encodeURIComponent(requestId)}/resolve`, {
            method: 'POST',
            body: JSON.stringify({
                decision,
                streamId: this.activeStreamId,
            }),
        });
        this.pendingApprovals.delete(requestId);
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

    private toPendingApproval(payload: Record<string, unknown>): PendingApproval {
        const rawRequest = typeof payload.payload === 'object' && payload.payload !== null
            ? payload.payload as Record<string, unknown>
            : {};
        const risk = rawRequest.risk;
        return {
            requestId: String(payload.requestId ?? rawRequest.toolCallId ?? 'approval'),
            summary: String(rawRequest.summary ?? payload.summary ?? 'Tool approval requested'),
            toolName: String(rawRequest.toolName ?? 'tool'),
            ...(typeof rawRequest.preview === 'string' && rawRequest.preview.trim().length > 0
                ? { preview: rawRequest.preview }
                : {}),
            ...(typeof rawRequest.reason === 'string' && rawRequest.reason.trim().length > 0
                ? { reason: rawRequest.reason }
                : {}),
            ...(risk === 'low' || risk === 'medium' || risk === 'high'
                ? { risk }
                : {}),
        };
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

        this.sessionId = persisted.sessionId ?? this.sessionId;
        this.activeStreamId = persisted.activeStreamId;
        this.busy = persisted.busy;
        this.status = persisted.status || 'idle';
        this.transcript.push(...persisted.transcript);

        for (const approval of persisted.approvals) {
            this.pendingApprovals.set(approval.requestId, approval);
        }

        for (const question of persisted.questions) {
            this.pendingQuestions.set(question.requestId, question);
        }
    }

    private appendTranscript(role: PanelTranscriptMessage['role'], content: string): number {
        this.transcript.push({ role, content });
        return this.transcript.length - 1;
    }

    private postState(): void {
        const payload: PanelStatePayload = {
            sessionId: this.sessionId,
            status: this.status,
            busy: this.busy,
            transcript: this.transcript,
            approvals: Array.from(this.pendingApprovals.values()),
            questions: Array.from(this.pendingQuestions.values()),
        };

        void this.context.workspaceState.update(PANEL_STATE_KEY, {
            ...payload,
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
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 16px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
    .stack { display: grid; gap: 12px; }
    textarea { width: 100%; min-height: 88px; resize: vertical; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 10px; }
    button { border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 6px 12px; cursor: pointer; }
    button.secondary { background: transparent; color: var(--vscode-foreground); border-color: var(--vscode-input-border); }
    .row { display: flex; gap: 8px; align-items: center; }
    .muted { opacity: 0.75; font-size: 12px; }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 10px; background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-editor-foreground) 8%); }
    .transcript { display: grid; gap: 8px; }
    .msg-user { border-left: 3px solid var(--vscode-textLink-foreground); padding-left: 8px; }
    .msg-assistant { border-left: 3px solid var(--vscode-charts-green); padding-left: 8px; }
    .msg-system { border-left: 3px solid var(--vscode-charts-yellow); padding-left: 8px; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 6px 0 0; }
  </style>
</head>
<body>
  <div class="stack">
    <div class="row">
      <strong>XQoder</strong>
      <span id="status" class="muted">idle</span>
      <span id="session" class="muted"></span>
    </div>
    <textarea id="prompt" placeholder="Ask XQoder to inspect, edit, and verify the current project..."></textarea>
    <div class="row">
      <button id="send">Send</button>
      <span class="muted">Selection is attached automatically when enabled in settings.</span>
    </div>
    <div id="approvals" class="stack"></div>
    <div id="questions" class="stack"></div>
    <div id="transcript" class="transcript"></div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const status = document.getElementById('status');
    const session = document.getElementById('session');
    const prompt = document.getElementById('prompt');
    const transcript = document.getElementById('transcript');
    const approvals = document.getElementById('approvals');
    const questions = document.getElementById('questions');
    document.getElementById('send').addEventListener('click', () => {
      vscode.postMessage({ type: 'send-prompt', prompt: prompt.value });
      prompt.value = '';
    });
    window.addEventListener('message', (event) => {
      const payload = event.data?.payload;
      if (!payload) {
        return;
      }
      status.textContent = payload.busy ? payload.status + '...' : payload.status;
      session.textContent = payload.sessionId ? 'session=' + payload.sessionId : 'session=none';
      transcript.innerHTML = payload.transcript.map((entry) => '<div class="card msg-' + entry.role + '"><strong>' + entry.role + '</strong><pre>' + escapeHtml(entry.content) + '</pre></div>').join('');
      approvals.innerHTML = payload.approvals.map((entry) => '<div class="card"><strong>Approval</strong><div>' + escapeHtml(entry.summary) + '</div><div class="muted">' + escapeHtml(entry.toolName) + (entry.risk ? ' · risk=' + escapeHtml(entry.risk) : '') + '</div><div class="row"><button data-request="' + escapeHtml(entry.requestId) + '" data-decision="allow">Allow</button><button class="secondary" data-request="' + escapeHtml(entry.requestId) + '" data-decision="deny">Deny</button><button class="secondary" data-preview="' + escapeHtml(entry.requestId) + '">Preview</button></div></div>').join('');
      questions.innerHTML = payload.questions.map((entry) => '<div class="card"><strong>' + escapeHtml(entry.header || 'Question') + '</strong><div>' + escapeHtml(entry.question) + '</div><div class="row">' + entry.options.map((option) => '<button data-question="' + escapeHtml(entry.requestId) + '" data-option="' + escapeHtml(option.label) + '">' + escapeHtml(option.label) + '</button>').join('') + '</div></div>').join('');
      document.querySelectorAll('[data-decision]').forEach((button) => {
        button.onclick = () => vscode.postMessage({
          type: 'resolve-approval',
          requestId: button.getAttribute('data-request'),
          decision: button.getAttribute('data-decision'),
        });
      });
      document.querySelectorAll('[data-preview]').forEach((button) => {
        button.onclick = () => vscode.postMessage({
          type: 'open-preview',
          requestId: button.getAttribute('data-preview'),
        });
      });
      document.querySelectorAll('[data-question]').forEach((button) => {
        button.onclick = () => vscode.postMessage({
          type: 'resolve-question',
          requestId: button.getAttribute('data-question'),
          selected: button.getAttribute('data-option'),
        });
      });
    });
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    }
  </script>
</body>
</html>`;
    }
}
